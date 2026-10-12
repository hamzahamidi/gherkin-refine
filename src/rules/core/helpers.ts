import type { Scenario, Tag } from "@cucumber/messages";
import type { LintDocument } from "../../types.js";
import { forEachChild, forEachStep } from "../../parser/document.js";
import { checkedOptions, isPositiveInteger, OPTIONS_OBJECT_REQUIRED, regexError } from "../define.js";
import { isRecord, isStringArray } from "../helpers.js";

export const NAME_LENGTH_KEYS = ["Feature", "Rule", "Scenario", "Step"] as const;
export const nameLengthOptions = checkedOptions<{ max: number } | Partial<Record<(typeof NAME_LENGTH_KEYS)[number], number>>>((value) => {
  if (!isRecord(value)) return OPTIONS_OBJECT_REQUIRED;
  if ("max" in value) {
    if (Object.keys(value).length !== 1) return "max cannot be combined with Feature, Rule, Scenario or Step limits";
    return isPositiveInteger(value.max) ? undefined : "max must be a positive integer";
  }
  for (const [key, limit] of Object.entries(value)) {
    if (!(NAME_LENGTH_KEYS as readonly string[]).includes(key)) return `unknown option ${key}; use max, Feature, Rule, Scenario or Step`;
    if (!isPositiveInteger(limit)) return `${key} must be a positive integer`;
  }
  return undefined;
});
export interface DuplicateScenarioOptions {
  readonly scope?: "feature" | "anywhere";
}
export const duplicateScenarioOptions = checkedOptions<DuplicateScenarioOptions>((value) => {
  if (!isRecord(value)) return OPTIONS_OBJECT_REQUIRED;
  const unknown = Object.keys(value).find((key) => key !== "scope");
  if (unknown !== undefined) return `unknown option ${unknown}`;
  return value.scope === undefined || value.scope === "feature" || value.scope === "anywhere" ? undefined : 'scope must be "feature" or "anywhere"';
});
export const scenarioSizeOptions = checkedOptions<{ maxSteps: number }>((value) => {
  if (!isRecord(value)) return OPTIONS_OBJECT_REQUIRED;
  return isPositiveInteger(value.maxSteps) ? undefined : "maxSteps must be a positive integer";
});
export const featureSizeOptions = checkedOptions<{ maxScenarios: number; countOutlineExamples?: boolean }>((value) => {
  if (!isRecord(value)) return OPTIONS_OBJECT_REQUIRED;
  if (!isPositiveInteger(value.maxScenarios)) return "maxScenarios must be a positive integer";
  if (value.countOutlineExamples !== undefined && typeof value.countOutlineExamples !== "boolean") return "countOutlineExamples must be a boolean";
  return undefined;
});
export const tagPatternOptions = checkedOptions<{ pattern: string }>((value) => {
  if (!isRecord(value)) return OPTIONS_OBJECT_REQUIRED;
  if (typeof value.pattern !== "string") return "pattern must be a string";
  return regexError("pattern", value.pattern);
});
export interface TagListOptions {
  readonly tags?: string[];
  readonly patterns?: string[];
}
export const tagListOptions = checkedOptions<TagListOptions>((value) => {
  if (!isRecord(value)) return OPTIONS_OBJECT_REQUIRED;
  if (value.tags !== undefined && !isStringArray(value.tags)) return "tags must be an array of strings";
  if (value.patterns === undefined) return undefined;
  if (!isStringArray(value.patterns)) return "patterns must be an array of strings";
  for (const pattern of value.patterns) {
    const error = regexError("patterns entry", pattern);
    if (error) return error;
  }
  return undefined;
});
export function tagMatcher(options: TagListOptions): (name: string) => boolean {
  const { tags = [], patterns = [] } = options;
  const expressions = patterns.map((pattern) => new RegExp(pattern));
  return (name) => tags.includes(name) || expressions.some((expression) => expression.test(name));
}
export function outlinePlaceholders(scenario: Scenario): string[] {
  const values: string[] = [scenario.name];
  for (const step of scenario.steps) {
    values.push(step.text);
    if (step.docString) values.push(step.docString.content);
    if (step.dataTable) {
      for (const row of step.dataTable.rows) values.push(...row.cells.map((cell) => cell.value));
    }
  }
  return values.flatMap((value) => [...value.matchAll(/<([^<>]+)>/g)].map((match) => match[1] ?? ""));
}
export function tagGroups(document: LintDocument): readonly Readonly<{ tags: readonly Tag[]; scope: string }>[] {
  const feature = document.feature;
  if (!feature) return [];
  const groups: { tags: readonly Tag[]; scope: string }[] = [
    { tags: feature.tags, scope: "Feature" }
  ];
  forEachChild(feature, ({ rule, scenario }) => {
    if (rule) groups.push({ tags: rule.tags, scope: "Rule" });
    if (!scenario) return;
    groups.push({ tags: scenario.tags, scope: "Scenario" });
    for (const examples of scenario.examples) groups.push({ tags: examples.tags, scope: "Examples" });
  });
  return groups;
}
export function docStringContentLines(document: LintDocument): ReadonlySet<number> {
  const contentLines = new Set<number>();
  forEachStep(document, (step) => {
    const docString = step.docString;
    if (!docString) return;
    const openingLine = docString.location.line;
    let closingLine = openingLine + 1;
    while (closingLine <= document.lines.length && !document.lines[closingLine - 1]?.trimStart().startsWith(docString.delimiter)) {
      closingLine += 1;
    }
    for (let line = openingLine + 1; line < closingLine; line += 1) contentLines.add(line);
  });
  return contentLines;
}
const STAGE_NAMES = ["unknown", "Given", "When", "Then"] as const;

export function stageName(stage: number): string {
  return STAGE_NAMES[stage] ?? "unknown";
}
