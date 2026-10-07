import type {
  Background,
  Examples,
  Feature,
  GherkinDocument,
  Rule,
  Scenario,
  Step,
  Tag
} from "@cucumber/messages";
import { AstBuilder, GherkinClassicTokenMatcher, Parser } from "@cucumber/gherkin";
import { IdGenerator } from "@cucumber/messages";
import type { LintDocument, Position, RuleVisitor, SourceRange } from "../types.js";

export interface ParseFailure {
  readonly message: string;
  readonly location: Position;
}

export type ParseResult =
  | Readonly<{ document: LintDocument; errors: readonly [] }>
  | Readonly<{ document?: never; errors: readonly ParseFailure[] }>;

export function parseGherkin(source: string, filePath: string): ParseResult {
  try {
    const parser = new Parser(new AstBuilder(IdGenerator.uuid()), new GherkinClassicTokenMatcher());
    const ast = parser.parse(source);
    return { document: createLintDocument(source, filePath, ast), errors: [] };
  } catch (error) {
    const errors = error instanceof Error && "errors" in error && Array.isArray(error.errors)
      ? error.errors
      : [error];
    return {
      errors: errors.map((item) => {
        const itemError = item instanceof Error ? item : new Error(String(item));
        const location = "location" in itemError && itemError.location && typeof itemError.location === "object"
          ? itemError.location as { line?: number; column?: number }
          : undefined;
        return {
          message: itemError.message.replace(/^\(\d+:\d+\):\s*/, ""),
          location: {
            line: location?.line && location.line > 0 ? location.line : 1,
            column: location?.column && location.column > 0 ? location.column : 1
          }
        };
      })
    };
  }
}

function createLintDocument(source: string, filePath: string, ast: GherkinDocument): LintDocument {
  const lines = source.split(/\r\n|\n|\r/);
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + (source.slice(offset + line.length, offset + line.length + 2) === "\r\n" ? 2 : 1);
  }
  return {
    filePath,
    source,
    lines,
    ast,
    ...(ast.feature ? { feature: ast.feature } : {}),
    language: ast.feature?.language ?? languageFromHeader(source) ?? "en",
    offsetAt(position) {
      const start = lineStarts[Math.max(0, Math.min(position.line - 1, lineStarts.length - 1))] ?? 0;
      return Math.max(0, Math.min(source.length, start + Math.max(position.column - 1, 0)));
    },
    positionAt(index) {
      const target = Math.max(0, Math.min(index, source.length));
      let low = 0;
      let high = lineStarts.length;
      while (low + 1 < high) {
        const middle = (low + high) >>> 1;
        if ((lineStarts[middle] ?? 0) <= target) low = middle;
        else high = middle;
      }
      return { line: low + 1, column: target - (lineStarts[low] ?? 0) + 1 };
    },
    rangeForLine(lineNumber) {
      const index = Math.max(0, Math.min(lineNumber - 1, lines.length - 1));
      const start = lineStarts[index] ?? 0;
      return [start, start + (lines[index]?.length ?? 0)];
    },
    textForRange(range) {
      return source.slice(range[0], range[1]);
    }
  };
}

function languageFromHeader(source: string): string | undefined {
  const match = source.match(/^\s*#\s*language\s*:\s*([\w-]+)/m);
  return match?.[1];
}

export function forEachRule(document: LintDocument, visitor: RuleVisitor<Rule>): void {
  const feature = document.feature;
  if (!feature) return;
  for (const child of feature.children) {
    if (child.rule) visitor(child.rule, { feature, rule: child.rule });
  }
}

export function forEachScenario(document: LintDocument, visitor: RuleVisitor<Scenario>): void {
  const feature = document.feature;
  if (!feature) return;
  for (const child of feature.children) {
    if (child.scenario) visitor(child.scenario, { feature, scenario: child.scenario });
    if (child.rule) {
      for (const nested of child.rule.children) {
        if (nested.scenario) visitor(nested.scenario, { feature, rule: child.rule, scenario: nested.scenario });
      }
    }
  }
}

export function forEachStep(document: LintDocument, visitor: RuleVisitor<Step>): void {
  const feature = document.feature;
  if (!feature) return;
  for (const child of feature.children) {
    if (child.background) visitBackgroundSteps(feature, child.background, visitor);
    if (child.scenario) visitScenarioSteps(feature, child.scenario, visitor);
    if (child.rule) {
      for (const nested of child.rule.children) {
        if (nested.background) visitBackgroundSteps(feature, nested.background, visitor, child.rule);
        if (nested.scenario) visitScenarioSteps(feature, nested.scenario, visitor, child.rule);
      }
    }
  }
}

function visitBackgroundSteps(
  feature: Feature,
  background: Background,
  visitor: RuleVisitor<Step>,
  rule?: Rule
): void {
  for (const step of background.steps) visitor(step, { feature, ...(rule ? { rule } : {}), background, step });
}

function visitScenarioSteps(
  feature: Feature,
  scenario: Scenario,
  visitor: RuleVisitor<Step>,
  rule?: Rule
): void {
  for (const step of scenario.steps) visitor(step, { feature, ...(rule ? { rule } : {}), scenario, step });
}

export function forEachExamples(document: LintDocument, visitor: RuleVisitor<Examples>): void {
  forEachScenario(document, (scenario, location) => {
    for (const examples of scenario.examples) visitor(examples, { ...location, examples });
  });
}

export function forEachTag(document: LintDocument, visitor: RuleVisitor<Tag>): void {
  const feature = document.feature;
  if (!feature) return;
  for (const tag of feature.tags) visitor(tag, { feature, tag });
  for (const child of feature.children) {
    if (child.rule) {
      for (const tag of child.rule.tags) visitor(tag, { feature, rule: child.rule, tag });
    }
    if (child.scenario) visitScenarioTags(feature, child.scenario, visitor);
    if (child.rule) {
      for (const nested of child.rule.children) {
        if (nested.scenario) visitScenarioTags(feature, nested.scenario, visitor, child.rule);
      }
    }
  }
}

function visitScenarioTags(
  feature: Feature,
  scenario: Scenario,
  visitor: RuleVisitor<Tag>,
  rule?: Rule
): void {
  for (const tag of scenario.tags) visitor(tag, { feature, ...(rule ? { rule } : {}), scenario, tag });
  for (const examples of scenario.examples) {
    for (const tag of examples.tags) visitor(tag, { feature, ...(rule ? { rule } : {}), scenario, examples, tag });
  }
}

export function sourceRange(document: LintDocument, line: number, column: number, length = 1): SourceRange {
  const start = document.offsetAt({ line, column });
  return [start, Math.min(start + length, document.source.length)];
}
