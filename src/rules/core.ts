import type { RuleModule } from "../types.js";
import { formattingRules } from "./core/formatting.js";
import { initialRules } from "./core/initial.js";
import { namingTagsRules } from "./core/namingTags.js";
import { projectRules } from "./core/project.js";
import { structureRules } from "./core/structure.js";
import { legacyRules } from "./legacy.js";

export { projectRules };
export const fileRules: Readonly<Record<string, RuleModule<unknown>>> = Object.assign(
  {}, initialRules, namingTagsRules, structureRules, formattingRules, legacyRules
);

export const recommendedRules = {
  "no-duplicate-tags": "error",
  "no-unused-outline-variables": "error",
  "no-undefined-outline-variables": "error",
  "no-duplicate-feature-names": "error",
  "no-duplicate-scenario-names": "error"
} as const;

export function metadataForRules(): Readonly<Record<string, Readonly<RuleModule<unknown>["meta"]>>> {
  return Object.fromEntries(Object.entries(fileRules).map(([id, rule]) => [id, rule.meta]));
}
