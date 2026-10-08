import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { LintConfig, RuleSetting, SeverityInput } from "../types.js";
import { ConfigError } from "../config/index.js";

export interface MigrationResult {
  readonly config: LintConfig;
  readonly content: string;
  readonly mapped: readonly string[];
  readonly unsupported: readonly string[];
}

export async function migrateLegacyFile(
  inputPath: string,
  options: { readonly outputPath?: string; readonly dryRun?: boolean; readonly force?: boolean } = {}
): Promise<MigrationResult> {
  const source = await readFile(inputPath, "utf8");
  let legacy: unknown;
  try {
    legacy = JSON.parse(stripJsonComments(source));
  } catch (error) {
    throw new ConfigError(`Legacy configuration must contain valid JSON with optional comments: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  if (!isRecord(legacy)) throw new ConfigError("Legacy configuration must be a JSON object.");
  const result = migrateLegacyConfig(legacy);
  if (!options.dryRun) {
    const outputPath = resolve(options.outputPath ?? "gherkin-refine.config.json");
    if (!options.force) {
      try {
        const { access } = await import("node:fs/promises");
        await access(outputPath);
        throw new ConfigError(`Output already exists: ${outputPath}. Use --force to replace it.`);
      } catch (error) {
        if (error instanceof ConfigError) throw error;
      }
    }
    await writeFile(outputPath, result.content, { encoding: "utf8", flag: options.force ? "w" : "wx" });
  }
  return result;
}

export function migrateLegacyConfig(legacy: Readonly<Record<string, unknown>>): MigrationResult {
  const rules: Record<string, RuleSetting> = {};
  const mapped: string[] = [];
  const unsupported: string[] = [];
  for (const [oldId, rawSetting] of Object.entries(legacy)) {
    const parsed = parseLegacySetting(rawSetting);
    if (!parsed) {
      unsupported.push(`${oldId}: unsupported setting`);
      continue;
    }
    const mapping = mapLegacyRule(oldId, parsed.options);
    if (!mapping) {
      unsupported.push(`${oldId}: no equivalent rule`);
      continue;
    }
    const [newId, options, note] = mapping;
    rules[newId] = options === undefined ? parsed.severity : [parsed.severity, options];
    mapped.push(`${oldId} -> ${newId}${note ? ` (${note})` : ""}`);
    if (note?.startsWith("partial:")) unsupported.push(`${oldId}: ${note.slice("partial:".length).trim()}`);
  }
  const config: LintConfig = { rules };
  return { config, content: `${JSON.stringify(config, null, 2)}\n`, mapped, unsupported };
}

function parseLegacySetting(value: unknown): { severity: SeverityInput; options?: unknown } | undefined {
  const rawSeverity = Array.isArray(value) ? value[0] : value;
  const options = Array.isArray(value) ? value[1] : undefined;
  if (rawSeverity === "on" || rawSeverity === true || rawSeverity === "error" || rawSeverity === 2) {
    return { severity: "error", ...(options !== undefined ? { options } : {}) };
  }
  if (rawSeverity === "off" || rawSeverity === false || rawSeverity === "warn" || rawSeverity === "warning" || rawSeverity === 1 || rawSeverity === 0) {
    const severity: SeverityInput = rawSeverity === "warn" || rawSeverity === "warning" || rawSeverity === 1 ? "warn" : "off";
    return { severity, ...(options !== undefined ? { options } : {}) };
  }
  return undefined;
}

function mapLegacyRule(oldId: string, options: unknown): readonly [string, unknown?, string?] | undefined {
  const direct: Readonly<Record<string, string>> = {
    "no-duplicate-tags": "no-duplicate-tags",
    "no-dupe-feature-names": "no-duplicate-feature-names",
    "no-dupe-scenario-names": "no-duplicate-scenario-names",
    "no-unused-variables": "no-unused-outline-variables",
    "no-trailing-spaces": "no-trailing-whitespace",
    "no-multiple-empty-lines": "no-extra-blank-lines",
    "keywords-in-logical-order": "logical-keyword-order",
    "scenario-size": "scenario-size",
    "name-length": "name-length"
  };
  const newId = direct[oldId];
  if (!newId) return undefined;
  if (oldId === "scenario-size") {
    const value = isRecord(options) ? options : {};
    const stepsLength = isRecord(value["steps-length"]) ? value["steps-length"] : value;
    const scenarioLimit = stepsLength.Scenario ?? stepsLength.scenario ?? stepsLength.maxSteps;
    if (Number.isInteger(scenarioLimit) && Number(scenarioLimit) > 0) {
      const backgroundLimit = stepsLength.Background ?? stepsLength.background;
      const note = Number.isInteger(backgroundLimit) ? "partial: Background limits need a separate rule." : undefined;
      return note ? [newId, { maxSteps: Number(scenarioLimit) }, note] : [newId, { maxSteps: Number(scenarioLimit) }];
    }
    return [newId, { maxSteps: 12 }, "partial: no Scenario limit was present, so the modern default is 12 steps."];
  }
  if (oldId === "name-length") {
    if (!isRecord(options)) return [newId, { max: 70 }];
    const feature = options.Feature ?? options.feature;
    const scenario = options.Scenario ?? options.scenario;
    if (Number.isInteger(feature) && Number.isInteger(scenario) && Number(feature) === Number(scenario)) {
      const note = options.Step !== undefined ? "partial: Step-name limits do not have a modern equivalent." : undefined;
      return note ? [newId, { max: Number(feature) }, note] : [newId, { max: Number(feature) }];
    }
    return [newId, { max: 70 }, "partial: different Feature and Scenario limits cannot be represented by one name-length option."];
  }
  if (oldId === "no-dupe-scenario-names") {
    const scope = typeof options === "string" ? options : "anywhere";
    return [newId, undefined, scope === "in-feature" ? "scope now includes the enclosing Rule" : "partial: modern scope is within each Feature or Rule, not across all files."];
  }
  if (options !== undefined) return [newId, options];
  return [newId];
}

function stripJsonComments(source: string): string {
  let output = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index] ?? "";
    const next = source[index + 1] ?? "";
    if (inString) {
      output += current;
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === '"') inString = false;
      continue;
    }
    if (current === '"') {
      inString = true;
      output += current;
    } else if (current === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
      output += "\n";
    } else if (current === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1;
      index += 1;
    } else {
      output += current;
    }
  }
  return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
