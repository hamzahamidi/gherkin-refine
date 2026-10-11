import { dialects } from "@cucumber/gherkin";
import type { Feature, Rule, Scenario, Step, Tag } from "@cucumber/messages";
import type { LintDocument } from "../../types.js";

export const INDENTATION_DEFAULTS: Readonly<Record<string, number>> = {
  Feature: 0,
  Background: 0,
  Rule: 0,
  Scenario: 0,
  Step: 2,
  Examples: 0,
  example: 2,
  given: 2,
  when: 2,
  then: 2,
  and: 2,
  but: 2
};
export const INDENTATION_KEYS = new Set([...Object.keys(INDENTATION_DEFAULTS), "feature tag", "scenario tag", "rule content"]);
export const RESTRICTED_PATTERN_KEYS = new Set(["Global", "Feature", "Background", "Scenario", "ScenarioOutline", "Rule"]);
export function isValidPattern(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}
export function keywordKey(keyword: string, language: string): string | undefined {
  const dialect = dialects[language] ?? dialects.en;
  for (const [key, values] of Object.entries(dialect ?? {})) {
    if (Array.isArray(values) && values.includes(keyword)) return key;
  }
  return undefined;
}
export function nodeType(keyword: string, language: string): string {
  const types: Readonly<Record<string, string>> = { feature: "Feature", rule: "Rule", background: "Background", scenario: "Scenario", scenarioOutline: "Scenario Outline", examples: "Examples" };
  return types[keywordKey(keyword, language) ?? ""] ?? keyword;
}
export function containers(feature: Feature): readonly Readonly<{ node: Feature | Rule; scenarios: readonly Scenario[] }>[] {
  const rules = feature.children.flatMap((child) => (child.rule ? [child.rule] : []));
  return [
    { node: feature, scenarios: feature.children.flatMap((child) => (child.scenario ? [child.scenario] : [])) },
    ...rules.map((rule) => ({ node: rule, scenarios: rule.children.flatMap((child) => (child.scenario ? [child.scenario] : [])) }))
  ];
}
export function stepGroups(feature: Feature): readonly (readonly Step[])[] {
  return feature.children.flatMap((child) => [
    ...(child.background ? [child.background.steps] : []),
    ...(child.scenario ? [child.scenario.steps] : []),
    ...(child.rule?.children.flatMap((nested) => [
      ...(nested.background ? [nested.background.steps] : []),
      ...(nested.scenario ? [nested.scenario.steps] : [])
    ]) ?? [])
  ]);
}
export function tagsByLine(tags: readonly Tag[]): readonly (readonly Tag[])[] {
  const lines = new Map<number, Tag[]>();
  for (const tag of tags) lines.set(tag.location.line, [...(lines.get(tag.location.line) ?? []), tag]);
  return [...lines.values()].map((line) => [...line].sort((left, right) => (left.location.column ?? 1) - (right.location.column ?? 1)));
}
export function intersection(groups: readonly (readonly string[])[]): readonly string[] {
  const [first, ...rest] = groups;
  if (!first) return [];
  return [...new Set(first)].filter((name) => rest.every((group) => group.includes(name)));
}
export function indentationFix(document: LintDocument, line: number, column: number, expected: number) {
  const start = document.offsetAt({ line, column: 1 });
  return { range: [start, start + column - 1] as const, text: " ".repeat(expected) };
}
