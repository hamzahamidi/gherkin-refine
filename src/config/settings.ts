import type { LintConfig, RuleSetting, Severity } from "../types.js";
import { ConfigError, isRecord } from "./errors.js";

export function validateConfigShape(config: unknown): asserts config is LintConfig {
  if (!isRecord(config)) throw new ConfigError("Configuration must export an object.");
  if (config.extends !== undefined && (!Array.isArray(config.extends) || !config.extends.every((item) => typeof item === "string"))) {
    throw new ConfigError("Configuration field extends must be an array of preset names.");
  }
  if (config.rules !== undefined && !isRecord(config.rules)) throw new ConfigError("Configuration field rules must be an object.");
  if (config.overrides !== undefined && (!Array.isArray(config.overrides) || !config.overrides.every(isRecord))) {
    throw new ConfigError("Configuration field overrides must be an array of objects.");
  }
  if (config.ignores !== undefined && (!Array.isArray(config.ignores) || !config.ignores.every((item) => typeof item === "string"))) {
    throw new ConfigError("Configuration field ignores must be an array of glob patterns.");
  }
  if (config.plugins !== undefined && (!Array.isArray(config.plugins) || !config.plugins.every((item) => typeof item === "string"))) {
    throw new ConfigError("Configuration field plugins must be an array of package names.");
  }
  if (config.reportUnusedDisableDirectives !== undefined && typeof config.reportUnusedDisableDirectives !== "boolean") {
    throw new ConfigError("Configuration field reportUnusedDisableDirectives must be a boolean.");
  }
  for (const field of ["maxConcurrency", "maxFixPasses"] as const) {
    const value = config[field];
    if (value !== undefined && (!Number.isInteger(value) || Number(value) < 1)) {
      throw new ConfigError(`Configuration field ${field} must be a positive integer.`);
    }
  }
  for (const [index, override] of (Array.isArray(config.overrides) ? config.overrides : []).entries()) {
    const files = override.files;
    if (!(typeof files === "string" || Array.isArray(files) && files.length > 0 && files.every((item) => typeof item === "string"))) {
      throw new ConfigError(`Configuration override ${index} requires files as a string or non-empty array of strings.`);
    }
    if (override.rules !== undefined && !isRecord(override.rules)) throw new ConfigError(`Configuration override ${index} rules must be an object.`);
    if (override.ignores !== undefined && (!Array.isArray(override.ignores) || !override.ignores.every((item) => typeof item === "string"))) {
      throw new ConfigError(`Configuration override ${index} ignores must be an array of glob patterns.`);
    }
  }
  for (const setting of [
    ...Object.values(isRecord(config.rules) ? config.rules : {}),
    ...(Array.isArray(config.overrides) ? config.overrides.flatMap((override) => Object.values(isRecord(override.rules) ? override.rules : {})) : [])
  ]) normalizeRuleSetting(setting as RuleSetting);
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
