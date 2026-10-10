import type { Feature, Tag } from "@cucumber/messages";
import type { LintDocument, RuleFix } from "../types.js";

export const DOCS_URL = "https://hamidihamza.com/gherkin-refine";

export function ruleDocs(id: string): string {
  return `${DOCS_URL}/rules/${id}`;
}

export function featureTags(feature: Feature): readonly Tag[] {
  return [
    ...feature.tags,
    ...feature.children.flatMap((child) => [
      ...(child.rule?.tags ?? []),
      ...(child.scenario?.tags ?? []),
      ...(child.scenario?.examples.flatMap((examples) => examples.tags) ?? []),
      ...(child.rule?.children.flatMap((nested) => [
        ...(nested.scenario?.tags ?? []),
        ...(nested.scenario?.examples.flatMap((examples) => examples.tags) ?? [])
      ]) ?? [])
    ])
  ];
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function lineDiagnostic(document: LintDocument, line: number, ruleId: string, message: string, endColumn?: number) {
  const lineText = document.lines[line - 1] ?? "";
  return {
    ruleId,
    severity: "error" as const,
    message,
    start: { line, column: 1 },
    end: { line, column: endColumn ?? Math.max(1, lineText.length + 1) }
  };
}

export function rangeDiagnostic(
  document: LintDocument,
  line: number,
  column: number,
  length: number,
  ruleId: string,
  message: string,
  fix?: RuleFix
) {
  const start = document.offsetAt({ line, column });
  const range = [start, Math.min(start + length, document.source.length)] as const;
  return {
    ruleId,
    severity: "error" as const,
    message,
    start: { line, column },
    end: { line, column: column + length },
    range,
    ...(fix ? { fix } : {})
  };
}
