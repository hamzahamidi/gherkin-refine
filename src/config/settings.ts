import type { LintConfig, RuleSetting, Severity } from "../types.js";
import { ConfigError, isRecord } from "./errors.js";

type FieldCheck = readonly [field: string, isValid: (value: unknown) => boolean, message: string];

const FIELD_CHECKS: readonly FieldCheck[] = [
  ["extends", isStringArray, "Configuration field extends must be an array of preset names."],
  ["rules", isRecord, "Configuration field rules must be an object."],
  ["overrides", (value) => Array.isArray(value) && value.every(isRecord), "Configuration field overrides must be an array of objects."],
  ["ignores", isStringArray, "Configuration field ignores must be an array of glob patterns."],
  ["plugins", isStringArray, "Configuration field plugins must be an array of package names."],
  ["reportUnusedDisableDirectives", (value) => typeof value === "boolean", "Configuration field reportUnusedDisableDirectives must be a boolean."],
  ["maxConcurrency", isPositiveInteger, "Configuration field maxConcurrency must be a positive integer."],
  ["maxFixPasses", isPositiveInteger, "Configuration field maxFixPasses must be a positive integer."]
];

export function validateConfigShape(config: unknown): asserts config is LintConfig {
  if (!isRecord(config)) throw new ConfigError("Configuration must export an object.");
  for (const [field, isValid, message] of FIELD_CHECKS) {
    if (config[field] !== undefined && !isValid(config[field])) throw new ConfigError(message);
  }
  const overrides = (config.overrides ?? []) as readonly Record<string, unknown>[];
  overrides.forEach(validateOverride);
  for (const setting of collectRuleSettings(config.rules, overrides)) normalizeRuleSetting(setting);
}

function validateOverride(override: Record<string, unknown>, index: number): void {
  const files = override.files;
  if (!(typeof files === "string" || isStringArray(files) && files.length > 0)) {
    throw new ConfigError(`Configuration override ${index} requires files as a string or non-empty array of strings.`);
  }
  if (override.rules !== undefined && !isRecord(override.rules)) throw new ConfigError(`Configuration override ${index} rules must be an object.`);
  if (override.ignores !== undefined && !isStringArray(override.ignores)) {
    throw new ConfigError(`Configuration override ${index} ignores must be an array of glob patterns.`);
  }
}

function collectRuleSettings(rules: unknown, overrides: readonly Record<string, unknown>[]): RuleSetting[] {
  return [rules, ...overrides.map((override) => override.rules)]
    .flatMap((ruleMap) => Object.values(isRecord(ruleMap) ? ruleMap : {})) as RuleSetting[];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isPositiveInteger(value: unknown): boolean {
  return Number.isInteger(value) && Number(value) >= 1;
}

export function normalizeRuleSetting(setting: RuleSetting): Readonly<{ severity: Severity; options: unknown }> {
  let severityInput: unknown = setting;
  let options: unknown;
  if (Array.isArray(setting)) {
    if (setting.length < 1 || setting.length > 2) throw new ConfigError("Rule setting arrays must contain a severity and optional options.");
    severityInput = setting[0];
    options = setting[1];
  }
  const severity = severityOf(severityInput);
  return { severity, options };
}

export function severityOf(input: unknown): Severity {
  if (input === "off" || input === 0) return "off";
  if (input === "warn" || input === 1) return "warn";
  if (input === "error" || input === 2) return "error";
  throw new ConfigError(`Invalid rule severity ${JSON.stringify(input)}. Use off, warn, error, 0, 1, or 2.`);
}
