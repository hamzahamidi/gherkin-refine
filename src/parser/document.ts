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

const LANGUAGE_HEADER = /#\s*language\s*:\s*([\w-]+)/y;

// Equivalent to /^\s*#\s*language\s*:\s*([\w-]+)/m, written as a scan because that regex is quadratic on long whitespace runs.
function languageFromHeader(source: string): string | undefined {
  for (let hash = source.indexOf("#"); hash >= 0; hash = source.indexOf("#", hash + 1)) {
    if (!onlyWhitespaceSinceLineStart(source, hash)) continue;
    LANGUAGE_HEADER.lastIndex = hash;
    const match = LANGUAGE_HEADER.exec(source);
    if (match) return match[1];
  }
  return undefined;
}

function onlyWhitespaceSinceLineStart(source: string, index: number): boolean {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const char = source[cursor] ?? "";
    if (/[\n\r\u2028\u2029]/.test(char)) return true;
    if (!/\s/.test(char)) return false;
  }
  return true;
}

interface ContainerChild {
  readonly background?: Background;
  readonly scenario?: Scenario;
  readonly rule?: Rule;
}

export function forEachChild(feature: Feature, visitor: (child: ContainerChild, rule?: Rule) => void): void {
  for (const child of feature.children) {
    visitor(child);
    if (child.rule) {
      for (const nested of child.rule.children) visitor(nested, child.rule);
    }
  }
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
  forEachChild(feature, ({ scenario }, rule) => {
    if (scenario) visitor(scenario, { feature, ...(rule ? { rule } : {}), scenario });
  });
}

export function forEachStep(document: LintDocument, visitor: RuleVisitor<Step>): void {
  const feature = document.feature;
  if (!feature) return;
  forEachChild(feature, ({ background, scenario }, rule) => {
    const parent = { feature, ...(rule ? { rule } : {}) };
    if (background) {
      for (const step of background.steps) visitor(step, { ...parent, background, step });
    }
    if (scenario) {
      for (const step of scenario.steps) visitor(step, { ...parent, scenario, step });
    }
  });
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
  forEachChild(feature, ({ rule: childRule, scenario }, rule) => {
    if (childRule) {
      for (const tag of childRule.tags) visitor(tag, { feature, rule: childRule, tag });
    }
    if (scenario) visitScenarioTags(feature, scenario, visitor, rule);
  });
}

function visitScenarioTags(
  feature: Feature,
  scenario: Scenario,
  visitor: RuleVisitor<Tag>,
  rule?: Rule
): void {
  const parent = { feature, ...(rule ? { rule } : {}), scenario };
  for (const tag of scenario.tags) visitor(tag, { ...parent, tag });
  for (const examples of scenario.examples) {
    for (const tag of examples.tags) visitor(tag, { ...parent, examples, tag });
  }
}

export function sourceRange(document: LintDocument, line: number, column: number, length = 1): SourceRange {
  const start = document.offsetAt({ line, column });
  return [start, Math.min(start + length, document.source.length)];
}
