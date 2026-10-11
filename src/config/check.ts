import type { LoadedConfig } from "./index.js";
import type { Severity } from "../types.js";
import { ConfigError } from "./errors.js";
import { effectiveConfig } from "./resolution.js";
import { normalizeRuleSetting } from "./settings.js";

export function validateConfiguration(loaded: LoadedConfig, filePaths: readonly string[], cwd: string): void {
  const entries: { id: string; setting: Readonly<{ severity: Severity; options: unknown }>; filePath: string }[] = [];
  for (const filePath of filePaths) {
    const effective = effectiveConfig(loaded, filePath, cwd);
    for (const [id, setting] of effective.rules) entries.push({ id, setting, filePath });
  }
  for (const [id, setting] of Object.entries(loaded.config.rules ?? {})) entries.push({ id, setting: normalizeRuleSetting(setting), filePath: "configuration" });
  for (const override of loaded.config.overrides ?? []) {
    for (const [id, setting] of Object.entries(override.rules ?? {})) entries.push({ id, setting: normalizeRuleSetting(setting), filePath: "configuration override" });
  }
  for (const { id, setting, filePath } of entries) {
    const module = loaded.fileRules.get(id) ?? loaded.projectRules.get(id);
    if (!module) throw new ConfigError(`Unknown rule ${JSON.stringify(id)} in configuration.`);
    const options = setting.options ?? module.meta.defaultOptions ?? {};
    if (module.validateOptions && !module.validateOptions(options)) {
      throw new ConfigError(`Invalid options for rule ${JSON.stringify(id)} in ${filePath}.`);
    }
  }
}
