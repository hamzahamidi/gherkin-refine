import type { RuleModule } from "../types.js";

export function defineRule<TOptions = unknown>(rule: RuleModule<TOptions>): RuleModule<TOptions> {
  if (!rule || typeof rule !== "object" || !rule.meta || typeof rule.run !== "function") {
    throw new TypeError("A rule must provide metadata and a run function.");
  }
  if (typeof rule.meta.description !== "string" || typeof rule.meta.category !== "string") {
    throw new TypeError("A rule must provide a description and category.");
  }
  return rule;
}

export type ValidatedOptions<TGuard> = TGuard extends (value: unknown) => value is infer TOptions ? TOptions : never;
