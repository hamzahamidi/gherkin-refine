import type { LoadedConfig } from "./index.js";
import type { RuleSetting, Severity } from "../types.js";
import { ConfigError } from "./errors.js";
import { effectiveConfig } from "./resolution.js";
import { configuredRuleIds, normalizeRuleSetting } from "./settings.js";

export function validateConfiguration(loaded: LoadedConfig, filePaths: readonly string[], cwd: string): void {
  const configured = configuredRuleIds(loaded.config);
  assertNoDuplicateLegacyRules(loaded.legacyRuleIds, configured);
  const entries = effectiveRuleEntries(loaded, filePaths, cwd);
  appendConfiguredRules(entries, loaded.config.rules, "configuration");
  for (const override of loaded.config.overrides ?? []) {
    appendConfiguredRules(entries, override.rules, "configuration override");
  }
  validateRuleEntries(loaded, entries);
}

interface ConfiguredRuleEntry {
  readonly id: string;
  readonly setting: Readonly<{ severity: Severity; options: unknown }>;
  readonly filePath: string;
}

function assertNoDuplicateLegacyRules(legacyRuleIds: ReadonlyMap<string, string>, configured: ReadonlySet<string>): void {
  for (const [legacyId, ruleId] of legacyRuleIds) {
    if (configured.has(legacyId) && configured.has(ruleId)) {
      throw new ConfigError(`Rules ${JSON.stringify(legacyId)} and ${JSON.stringify(ruleId)} are the same rule; configure only ${JSON.stringify(ruleId)}.`);
    }
  }
}

function effectiveRuleEntries(loaded: LoadedConfig, filePaths: readonly string[], cwd: string): ConfiguredRuleEntry[] {
  const entries: ConfiguredRuleEntry[] = [];
  for (const filePath of filePaths) {
    for (const [id, setting] of effectiveConfig(loaded, filePath, cwd).rules) entries.push({ id, setting, filePath });
  }
  return entries;
}

function appendConfiguredRules(
  entries: ConfiguredRuleEntry[],
  rules: Readonly<Record<string, RuleSetting>> | undefined,
  filePath: string
): void {
  for (const [id, setting] of Object.entries(rules ?? {})) entries.push({ id, setting: normalizeRuleSetting(setting), filePath });
}

function validateRuleEntries(loaded: LoadedConfig, entries: readonly ConfiguredRuleEntry[]): void {
  for (const { id, setting, filePath } of entries) {
    const module = loaded.fileRules.get(id) ?? loaded.projectRules.get(id);
    if (!module) throw new ConfigError(`Unknown rule ${JSON.stringify(id)} in configuration.`);
    if (setting.severity === "off" && setting.options === undefined) continue;
    const options = setting.options ?? module.meta.defaultOptions ?? {};
    if (module.validateOptions && !module.validateOptions(options)) {
      const reason = module.optionsError?.(options);
      const detail = reason ? `: ${reason}` : "";
      throw new ConfigError(`Invalid options for rule ${JSON.stringify(id)} in ${filePath}${detail}.`);
    }
  }
}
