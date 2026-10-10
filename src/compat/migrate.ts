import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { LintConfig, RuleSetting, SeverityInput } from "../types.js";
import { ConfigError } from "../config/index.js";
import { legacyRules } from "../rules/legacy.js";

export interface MigrationResult {
  readonly config: LintConfig;
  readonly content: string;
  readonly mapped: readonly string[];
  readonly unsupported: readonly string[];
  readonly notes: readonly string[];
}

const legacyNameLimit = 70;
const legacyStepsLimit = 15;

export async function migrateLegacyFile(
  inputPath: string,
  options: { readonly outputPath?: string; readonly dryRun?: boolean; readonly force?: boolean } = {}
): Promise<MigrationResult> {
  const result = migrateLegacyConfig(parseLegacyConfig(await readFile(inputPath, "utf8")));
  if (!options.dryRun) {
    const outputPath = resolve(options.outputPath ?? "gherkin-refine.config.json");
    if (!options.force) {
      try {
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

export function parseLegacyConfig(source: string): Readonly<Record<string, unknown>> {
  let legacy: unknown;
  try {
    legacy = JSON.parse(stripJsonComments(source));
  } catch (error) {
    throw new ConfigError(`Legacy configuration must contain valid JSON with optional comments: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  if (!isRecord(legacy)) throw new ConfigError("Legacy configuration must be a JSON object.");
  return legacy;
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
    const mappings = mapLegacyRule(oldId, parsed.options);
    if (!mappings) {
      if (parsed.severity !== "off") unsupported.push(`${oldId}: no equivalent rule`);
      continue;
    }
    if (mappings.length === 0) {
      if (parsed.severity !== "off") unsupported.push(`${oldId}: no Scenario or Background limit was present.`);
      continue;
    }
    if (parsed.severity === "off") {
      for (const [newId] of mappings) rules[newId] = "off";
      mapped.push(`${oldId} -> ${mappings.map(([newId]) => newId).join(", ")}`);
      continue;
    }
    for (const [newId, ruleOptions, note] of mappings) {
      rules[newId] = ruleOptions === undefined ? parsed.severity : [parsed.severity, ruleOptions];
      const partial = note?.startsWith("partial:") ? note.slice("partial:".length).trim() : undefined;
      mapped.push(`${oldId} -> ${newId}${partial ? " (partial)" : note ? ` (${note})` : ""}`);
      if (partial) unsupported.push(`${oldId}: ${partial}`);
    }
  }
  const notes = ["extends: [] keeps gherkin-lint behavior, where only listed rules run. Remove it to add the recommended rules."];
  const config: LintConfig = { extends: [], rules };
  return { config, content: `${JSON.stringify(config, null, 2)}\n`, mapped, unsupported, notes };
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

type RuleMapping = readonly [string, unknown?, string?];

function mapLegacyRule(oldId: string, options: unknown): readonly RuleMapping[] | undefined {
  const direct: Readonly<Record<string, string>> = {
    "no-duplicate-tags": "no-duplicate-tags",
    "no-dupe-feature-names": "no-duplicate-feature-names",
    "no-dupe-scenario-names": "no-duplicate-scenario-names",
    "no-unused-variables": "no-unused-outline-variables",
    "no-trailing-spaces": "no-trailing-whitespace",
    "no-multiple-empty-lines": "no-extra-blank-lines",
    "keywords-in-logical-order": "logical-keyword-order",
    "scenario-size": "scenario-size",
    "name-length": "name-length",
    "allowed-tags": "allowed-tags",
    "no-restricted-tags": "no-restricted-tags",
    ...Object.fromEntries(Object.keys(legacyRules).map((id) => [id, id]))
  };
  const newId = direct[oldId];
  if (!newId) return undefined;
  if (oldId === "scenario-size") {
    if (!isRecord(options) || Object.keys(options).length === 0) {
      return [[newId, { maxSteps: legacyStepsLimit }], ["background-size", { maxSteps: legacyStepsLimit }]];
    }
    const stepsLength = isRecord(options["steps-length"]) ? options["steps-length"] : options;
    const scenarioLimit = stepsLength.Scenario ?? stepsLength.scenario ?? stepsLength.maxSteps;
    const backgroundLimit = stepsLength.Background ?? stepsLength.background;
    const mappings: RuleMapping[] = [];
    if (isPositiveInteger(scenarioLimit)) mappings.push([newId, { maxSteps: scenarioLimit }]);
    if (isPositiveInteger(backgroundLimit)) mappings.push(["background-size", { maxSteps: backgroundLimit }]);
    return mappings;
  }
  if (oldId === "name-length") {
    const limits = isRecord(options) ? options : {};
    const feature = limitOrDefault(limits.Feature ?? limits.feature);
    const scenario = limitOrDefault(limits.Scenario ?? limits.scenario);
    const stepNote = "Step text limits do not have a modern equivalent.";
    if (feature === scenario) return [[newId, { max: feature }, `partial: ${stepNote}`]];
    const [lowerName, lower, higher] = feature < scenario ? ["Feature", feature, scenario] : ["Scenario", scenario, feature];
    return [[newId, { max: higher }, `partial: one limit covers Feature and Scenario names, so the ${lowerName} limit rises from ${lower} to ${higher}. ${stepNote}`]];
  }
  if (oldId === "no-dupe-scenario-names") {
    const scope = typeof options === "string" ? options : "anywhere";
    return [[newId, undefined, scope === "in-feature" ? "scope now includes the enclosing Rule" : "partial: modern scope is within each Feature or Rule, not across all files."]];
  }
  if (oldId === "allowed-tags" || oldId === "no-restricted-tags") {
    return [[newId, options, "scope now includes tags inside Rule blocks"]];
  }
  if (options !== undefined) return [[newId, options]];
  return [[newId]];
}

function limitOrDefault(value: unknown): number {
  return isPositiveInteger(value) ? value : legacyNameLimit;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
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
