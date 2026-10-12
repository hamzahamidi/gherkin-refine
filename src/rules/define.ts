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

export const OPTIONS_OBJECT_REQUIRED = "options must be an object";

export function checkedOptions<TOptions>(optionsError: (options: unknown) => string | undefined): {
  validateOptions(options: unknown): options is TOptions;
  optionsError(options: unknown): string | undefined;
} {
  return { validateOptions: (options): options is TOptions => optionsError(options) === undefined, optionsError };
}

export function isPositiveInteger(value: unknown): boolean {
  return Number.isInteger(value) && Number(value) > 0;
}

export function regexError(label: string, source: string): string | undefined {
  try {
    new RegExp(source);
    return undefined;
  } catch {
    return `${label} ${JSON.stringify(source)} is not a valid regular expression`;
  }
}
