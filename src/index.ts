import type { RuleModule } from "./types.js";

export { lintFiles, lintText, LintExecutionError } from "./core/engine.js";
export { defineConfig, ConfigError } from "./config/index.js";
export { formatResult } from "./formatters/index.js";
export type { CustomFormatter, FormatterName } from "./formatters/index.js";
export { forEachExamples, forEachRule, forEachScenario, forEachStep, forEachTag } from "./parser/document.js";
export { fileRules, projectRules, recommendedRules } from "./rules/core.js";
export type * from "./types.js";

export function defineRule<TOptions = unknown>(rule: RuleModule<TOptions>): RuleModule<TOptions> {
  if (!rule || typeof rule !== "object" || !rule.meta || typeof rule.run !== "function") {
    throw new TypeError("A rule must provide metadata and a run function.");
  }
  if (typeof rule.meta.description !== "string" || typeof rule.meta.category !== "string") {
    throw new TypeError("A rule must provide a description and category.");
  }
  return rule;
}
