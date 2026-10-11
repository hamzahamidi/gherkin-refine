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
  options: { readonly outputPath?: string; readonly dryRun?: boolean; readonly force?: boolean; readonly strict?: boolean } = {}
): Promise<MigrationResult> {
  const result = migrateLegacyConfig(parseLegacyConfig(await readFile(inputPath, "utf8")));
  if (options.strict && result.unsupported.length > 0) {
    throw new ConfigError(`Legacy rules cannot be fully migrated: ${result.unsupported.join("; ")}`);
  }
  if (!options.dryRun) {
    const outputPath = resolve(options.outputPath ?? "gherkin-refine.config.json");
    if (!options.force) await assertOutputAbsent(outputPath);
    await writeFile(outputPath, result.content, { encoding: "utf8", flag: options.force ? "w" : "wx" });
  }
  return result;
}

async function assertOutputAbsent(outputPath: string): Promise<void> {
  try {
    await access(outputPath);
  } catch {
    return;
  }
  throw new ConfigError(`Output already exists: ${outputPath}. Use --force to replace it.`);
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
    const entry = migrateEntry(oldId, rawSetting);
    Object.assign(rules, entry.rules);
    mapped.push(...entry.mapped);
    unsupported.push(...entry.unsupported);
  }
  const notes = ["extends: [] keeps gherkin-lint behavior, where only listed rules run. Remove it to add the recommended rules."];
  const config: LintConfig = { extends: [], rules };
  return { config, content: `${JSON.stringify(config, null, 2)}\n`, mapped, unsupported, notes };
}

interface EntryMigration {
  readonly rules: Readonly<Record<string, RuleSetting>>;
  readonly mapped: readonly string[];
  readonly unsupported: readonly string[];
}

function migrateEntry(oldId: string, rawSetting: unknown): EntryMigration {
  const parsed = parseLegacySetting(rawSetting);
  if (!parsed) return { rules: {}, mapped: [], unsupported: [`${oldId}: unsupported setting`] };
  const mappings = mapLegacyRule(oldId, parsed.options);
  if (!mappings || mappings.length === 0) {
    const reason = mappings ? "no Scenario or Background limit was present." : "no equivalent rule";
    return { rules: {}, mapped: [], unsupported: parsed.severity === "off" ? [] : [`${oldId}: ${reason}`] };
  }
  if (parsed.severity === "off") {
    return {
      rules: Object.fromEntries(mappings.map(([newId]) => [newId, "off"])),
      mapped: [`${oldId} -> ${mappings.map(([newId]) => newId).join(", ")}`],
      unsupported: []
    };
  }
  const severity = parsed.severity;
  const partials = mappings.map(([, , note]) => (note?.startsWith("partial:") ? note.slice("partial:".length).trim() : undefined));
  return {
    rules: Object.fromEntries(mappings.map(([newId, ruleOptions]) => [newId, ruleOptions === undefined ? severity : [severity, ruleOptions]])),
    mapped: mappings.map(([newId, , note], index) => `${oldId} -> ${newId}${mappingSuffix(note, partials[index])}`),
    unsupported: partials.filter((partial) => partial !== undefined && partial !== "").map((partial) => `${oldId}: ${partial}`)
  };
}

function mappingSuffix(note: string | undefined, partial: string | undefined): string {
  if (partial) return " (partial)";
  return note ? ` (${note})` : "";
}

const LEGACY_SEVERITIES = new Map<unknown, SeverityInput>([
  ["on", "error"], [true, "error"], ["error", "error"], [2, "error"],
  ["warn", "warn"], ["warning", "warn"], [1, "warn"],
  ["off", "off"], [false, "off"], [0, "off"]
]);

function parseLegacySetting(value: unknown): { severity: SeverityInput; options?: unknown } | undefined {
  const severity = LEGACY_SEVERITIES.get(Array.isArray(value) ? value[0] : value);
  if (severity === undefined) return undefined;
  const options = Array.isArray(value) ? value[1] : undefined;
  return { severity, ...(options !== undefined ? { options } : {}) };
}

type RuleMapping = readonly [string, unknown?, string?];

const RENAMED_RULES = new Map<string, string>([
  ["no-duplicate-tags", "no-duplicate-tags"],
  ["no-dupe-feature-names", "no-duplicate-feature-names"],
  ["no-dupe-scenario-names", "no-duplicate-scenario-names"],
  ["no-unused-variables", "no-unused-outline-variables"],
  ["no-trailing-spaces", "no-trailing-whitespace"],
  ["no-multiple-empty-lines", "no-extra-blank-lines"],
  ["keywords-in-logical-order", "logical-keyword-order"],
  ["scenario-size", "scenario-size"],
  ["name-length", "name-length"],
  ["allowed-tags", "allowed-tags"],
  ["no-restricted-tags", "no-restricted-tags"],
  ["no-homogenous-tags", "no-homogeneous-tags"],
  ["max-scenarios-per-file", "feature-size"]
]);

const OPTION_MAPPERS: Readonly<Record<string, (newId: string, options: unknown) => readonly RuleMapping[]>> = {
  "scenario-size": mapScenarioSize,
  "name-length": (newId, options) => {
    const limits = isRecord(options) ? options : {};
    return [[newId, Object.fromEntries(["Feature", "Rule", "Scenario", "Step"].map((key) => [key, limitOrDefault(limits[key] ?? limits[key.toLowerCase()])]))]];
  },
  "no-dupe-scenario-names": (newId, options) =>
    options === "in-feature" ? [[newId, undefined, "scope now includes the enclosing Rule"]] : [[newId, { scope: "anywhere" }]],
  "max-scenarios-per-file": (newId, options) => {
    const value = isRecord(options) ? options : {};
    return [[newId, {
      maxScenarios: Number.isInteger(value.maxScenarios) ? value.maxScenarios : 10,
      countOutlineExamples: typeof value.countOutlineExamples === "boolean" ? value.countOutlineExamples : true
    }]];
  },
  "no-unused-variables": (newId) => [[newId], ["no-undefined-outline-variables"]],
  "allowed-tags": (newId, options) => [[newId, options, "scope now includes tags inside Rule blocks"]],
  "no-restricted-tags": (newId, options) => [[newId, options, "scope now includes tags inside Rule blocks"]]
};

function mapLegacyRule(oldId: string, options: unknown): readonly RuleMapping[] | undefined {
  const newId = RENAMED_RULES.get(oldId) ?? (Object.hasOwn(legacyRules, oldId) ? oldId : undefined);
  if (!newId) return undefined;
  const mapOptions = OPTION_MAPPERS[oldId];
  if (mapOptions) return mapOptions(newId, options);
  return options === undefined ? [[newId]] : [[newId, options]];
}

function mapScenarioSize(newId: string, options: unknown): readonly RuleMapping[] {
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
