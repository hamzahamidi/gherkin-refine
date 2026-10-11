import type { Scenario, Tag } from "@cucumber/messages";
import type { LintDocument } from "../../types.js";
import { forEachChild, forEachStep } from "../../parser/document.js";
import type { ValidatedOptions } from "../define.js";
import { isRecord, isStringArray } from "../helpers.js";

export const NAME_LENGTH_KEYS = ["Feature", "Rule", "Scenario", "Step"] as const;
export const nameLengthOptions = (value: unknown): value is { max: number } | Partial<Record<(typeof NAME_LENGTH_KEYS)[number], number>> => {
  if (!isRecord(value)) return false;
  const isLimit = (limit: unknown) => Number.isInteger(limit) && Number(limit) > 0;
  if ("max" in value) return Object.keys(value).length === 1 && isLimit(value.max);
  return Object.entries(value).every(([key, limit]) => (NAME_LENGTH_KEYS as readonly string[]).includes(key) && isLimit(limit));
};
export const duplicateScenarioOptions = (value: unknown): value is { scope?: "feature" | "anywhere" } =>
  isRecord(value) && Object.keys(value).every((key) => key === "scope") && (value.scope === undefined || value.scope === "feature" || value.scope === "anywhere");
export const scenarioSizeOptions = (value: unknown): value is { maxSteps: number } =>
  isRecord(value) && Number.isInteger(value.maxSteps) && Number(value.maxSteps) > 0;
export const featureSizeOptions = (value: unknown): value is { maxScenarios: number; countOutlineExamples?: boolean } =>
  isRecord(value) && Number.isInteger(value.maxScenarios) && Number(value.maxScenarios) > 0
  && (value.countOutlineExamples === undefined || typeof value.countOutlineExamples === "boolean");
export const tagPatternOptions = (value: unknown): value is { pattern: string } => {
  if (!isRecord(value) || typeof value.pattern !== "string") return false;
  try {
    new RegExp(value.pattern);
    return true;
  } catch {
    return false;
  }
};
export const tagListOptions = (value: unknown): value is { tags?: string[]; patterns?: string[] } => {
  if (!isRecord(value)) return false;
  if (value.tags !== undefined && !isStringArray(value.tags)) return false;
  if (value.patterns === undefined) return true;
  if (!isStringArray(value.patterns)) return false;
  try {
    for (const pattern of value.patterns) new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
};
export function tagMatcher(options: ValidatedOptions<typeof tagListOptions>): (name: string) => boolean {
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
