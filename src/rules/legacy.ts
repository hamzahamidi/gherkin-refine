import type { RuleModule } from "../types.js";
import { formattingRules } from "./legacy/formatting.js";
import { indentationRules } from "./legacy/indentation.js";
import { metadataRules } from "./legacy/metadata.js";
import { stepsRules } from "./legacy/steps.js";
import { structureRules } from "./legacy/structure.js";
import { tagsRules } from "./legacy/tags.js";

export const legacyRules: Readonly<Record<string, RuleModule<unknown>>> = Object.assign(
  {}, structureRules, tagsRules, stepsRules, indentationRules, formattingRules, metadataRules
);
