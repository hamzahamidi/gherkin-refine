import { StepKeywordType } from "@cucumber/messages";
import type { LintDocument, ProjectRuleModule, RuleFix, RuleModule } from "../types.js";
import type { Scenario, Tag } from "@cucumber/messages";
import { forEachScenario, forEachStep } from "../parser/document.js";
import { featureTags, isRecord, isStringArray, lineDiagnostic, rangeDiagnostic } from "./helpers.js";
import { legacyRules } from "./legacy.js";

const nameLengthOptions = (value: unknown): value is { max: number } =>
  isRecord(value) && Number.isInteger(value.max) && Number(value.max) > 0;

const scenarioSizeOptions = (value: unknown): value is { maxSteps: number } =>
  isRecord(value) && Number.isInteger(value.maxSteps) && Number(value.maxSteps) > 0;

const featureSizeOptions = (value: unknown): value is { maxScenarios: number } =>
  isRecord(value) && Number.isInteger(value.maxScenarios) && Number(value.maxScenarios) > 0;

const tagPatternOptions = (value: unknown): value is { pattern: string } => {
  if (!isRecord(value) || typeof value.pattern !== "string") return false;
  try {
    new RegExp(value.pattern);
    return true;
  } catch {
    return false;
  }
};

const tagListOptions = (value: unknown): value is { tags?: string[]; patterns?: string[] } => {
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

function tagMatcher(options: unknown): (name: string) => boolean {
  const { tags = [], patterns = [] } = options as { tags?: string[]; patterns?: string[] };
  const expressions = patterns.map((pattern) => new RegExp(pattern));
  return (name) => tags.includes(name) || expressions.some((expression) => expression.test(name));
}

function outlinePlaceholders(scenario: Scenario): string[] {
  const values: string[] = [];
  for (const step of scenario.steps) {
    values.push(step.text);
    if (step.docString) values.push(step.docString.content);
    if (step.dataTable) {
      for (const row of step.dataTable.rows) values.push(...row.cells.map((cell) => cell.value));
    }
  }
  return values.flatMap((value) => [...value.matchAll(/<([^<>]+)>/g)].map((match) => match[1] ?? ""));
}

function tagGroups(document: LintDocument): readonly Readonly<{ tags: readonly Tag[]; scope: string }>[] {
  const feature = document.feature;
  if (!feature) return [];
  const groups: { tags: readonly Tag[]; scope: string }[] = [
    { tags: feature.tags, scope: "Feature" }
  ];
  for (const child of feature.children) {
    if (child.rule) groups.push({ tags: child.rule.tags, scope: "Rule" });
    if (child.scenario) {
      groups.push({ tags: child.scenario.tags, scope: "Scenario" });
      for (const examples of child.scenario.examples) groups.push({ tags: examples.tags, scope: "Examples" });
    }
    if (child.rule) {
      for (const nested of child.rule.children) {
        if (!nested.scenario) continue;
        groups.push({ tags: nested.scenario.tags, scope: "Scenario" });
        for (const examples of nested.scenario.examples) groups.push({ tags: examples.tags, scope: "Examples" });
      }
    }
  }
  return groups;
}

function docStringContentLines(document: LintDocument): ReadonlySet<number> {
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

export const fileRules: Readonly<Record<string, RuleModule<unknown>>> = {
  "unused-disable-directive": {
    meta: {
      description: "Report suppression comments that suppress no diagnostics when reporting is enabled.",
      category: "correctness",
      recommended: false,
      examples: ["# gherkin-refine-disable-next-line name-length -- legacy title"],
      documentation: "docs/configuration.md#inline-suppression"
    },
    run() {}
  },

  "no-duplicate-tags": {
    meta: {
      description: "Disallow duplicate tags on the same Gherkin element.",
      category: "correctness",
      recommended: true,
      examples: ["Feature: Login\n  @smoke @smoke\n  Scenario: valid login"],
      documentation: "docs/rules.md#no-duplicate-tags"
    },
    run({ document, report }) {
      for (const group of tagGroups(document)) {
        const seen = new Set<string>();
        for (const tag of group.tags) {
          if (!seen.has(tag.name)) {
            seen.add(tag.name);
            continue;
          }
          const line = tag.location.line;
          const column = tag.location.column ?? 1;
          report(rangeDiagnostic(document, line, column, tag.name.length, "no-duplicate-tags", `Duplicate tag ${tag.name}.`));
        }
      }
    }
  },

  "no-unused-outline-variables": {
    meta: {
      description: "Disallow Scenario Outline variables that are never used in steps or arguments.",
      category: "correctness",
      recommended: true,
      examples: ["Scenario Outline: lookup\n  Given <id> exists\n  Examples:\n    | id | unused |"],
      documentation: "docs/rules.md#no-unused-outline-variables"
    },
    run({ document, report }) {
      forEachScenario(document, (scenario) => {
        if (scenario.examples.length === 0) return;
        const used = new Set(outlinePlaceholders(scenario));
        for (const examples of scenario.examples) {
          for (const cell of examples.tableHeader?.cells ?? []) {
            if (!used.has(cell.value)) {
              const column = cell.location.column ?? 1;
              report(rangeDiagnostic(document, cell.location.line, column, cell.value.length, "no-unused-outline-variables", `Scenario Outline variable <${cell.value}> is not used.`));
            }
          }
        }
      });
    }
  },

  "no-undefined-outline-variables": {
    meta: {
      description: "Disallow Scenario Outline placeholders without a matching Examples column.",
      category: "correctness",
      recommended: true,
      examples: ["Scenario Outline: lookup\n  Given <missing> exists\n  Examples:\n    | id |"],
      documentation: "docs/rules.md#no-undefined-outline-variables"
    },
    run({ document, report }) {
      forEachScenario(document, (scenario) => {
        if (!scenario.examples.length) return;
        const declared = scenario.examples.map((examples) => new Set((examples.tableHeader?.cells ?? []).map((cell) => cell.value)));
        for (const step of scenario.steps) {
          const values = [
            step.text,
            ...(step.docString ? [step.docString.content] : []),
            ...(step.dataTable?.rows.flatMap((row) => row.cells.map((cell) => cell.value)) ?? [])
          ];
          let cursor = document.offsetAt({ line: step.location.line, column: step.location.column ?? 1 });
          for (const value of values) {
            for (const match of value.matchAll(/<([^<>]+)>/g)) {
              const name = match[1] ?? "";
              if (declared.length > 0 && declared.every((headers) => headers.has(name))) continue;
              let offset = document.source.indexOf(match[0], cursor);
              if (offset < 0) offset = cursor;
              const position = document.positionAt(offset);
              report(rangeDiagnostic(document, position.line, position.column, Math.max(name.length + 2, 1), "no-undefined-outline-variables", `Placeholder <${name}> has no matching Examples column.`));
              cursor = offset + match[0].length;
            }
          }
        }
      });
    }
  },

  "scenario-size": {
    meta: {
      description: "Limit the number of steps in a Scenario.",
      category: "structure",
      recommended: false,
      defaultOptions: { maxSteps: 12 },
      examples: ["Scenario: long flow\n  Given one\n  When two\n  Then three"],
      documentation: "docs/rules.md#scenario-size"
    },
    validateOptions: scenarioSizeOptions,
    run({ document, options, report }) {
      const { maxSteps } = options as { maxSteps: number };
      forEachScenario(document, (scenario) => {
        if (scenario.steps.length <= maxSteps) return;
        const line = scenario.location.line;
        report(lineDiagnostic(document, line, "scenario-size", `Scenario contains ${scenario.steps.length} steps; configured maximum is ${maxSteps}.`));
      });
    }
  },

  "background-size": {
    meta: {
      description: "Limit the number of steps in Feature and Rule Backgrounds.",
      category: "structure",
      recommended: false,
      defaultOptions: { maxSteps: 5 },
      examples: ["Rule: Coupon\n  Background:\n    Given many shared steps"],
      documentation: "docs/rules.md#background-size"
    },
    validateOptions: scenarioSizeOptions,
    run({ document, options, report }) {
      const maxSteps = (options as { maxSteps: number }).maxSteps;
      const feature = document.feature;
      if (!feature) return;
      for (const child of feature.children) {
        if (child.background && child.background.steps.length > maxSteps) {
          report(lineDiagnostic(document, child.background.location.line, "background-size", `Background contains ${child.background.steps.length} steps; configured maximum is ${maxSteps}.`));
        }
        if (!child.rule) continue;
        for (const nested of child.rule.children) {
          if (nested.background && nested.background.steps.length > maxSteps) {
            report(lineDiagnostic(document, nested.background.location.line, "background-size", `Rule Background contains ${nested.background.steps.length} steps; configured maximum is ${maxSteps}.`));
          }
        }
      }
    }
  },

  "feature-size": {
    meta: {
      description: "Limit the number of Scenarios in a Feature, including Scenarios under Rules.",
      category: "structure",
      recommended: false,
      defaultOptions: { maxScenarios: 20 },
      examples: ["Feature: Large workflow with more than the configured number of scenarios"],
      documentation: "docs/rules.md#feature-size"
    },
    validateOptions: featureSizeOptions,
    run({ document, options, report }) {
      const feature = document.feature;
      if (!feature) return;
      let count = 0;
      forEachScenario(document, () => { count += 1; });
      const { maxScenarios } = options as { maxScenarios: number };
      if (count > maxScenarios) {
        report(lineDiagnostic(document, feature.location.line, "feature-size", `Feature contains ${count} Scenarios; configured maximum is ${maxScenarios}.`));
      }
    }
  },

  "name-length": {
    meta: {
      description: "Limit Feature and Scenario name length.",
      category: "naming",
      recommended: false,
      defaultOptions: { max: 80 },
      examples: ["Scenario: A name longer than the configured maximum"],
      documentation: "docs/rules.md#name-length"
    },
    validateOptions: nameLengthOptions,
    run({ document, options, report }) {
      const { max } = options as { max: number };
      if (document.feature && document.feature.name.length > max) {
        report(lineDiagnostic(document, document.feature.location.line, "name-length", `Feature name has ${document.feature.name.length} characters; configured maximum is ${max}.`));
      }
      forEachScenario(document, (scenario) => {
        if (scenario.name.length > max) report(lineDiagnostic(document, scenario.location.line, "name-length", `Scenario name has ${scenario.name.length} characters; configured maximum is ${max}.`));
      });
    }
  },

  "tag-pattern": {
    meta: {
      description: "Require tags to match a configured regular expression.",
      category: "tags",
      recommended: false,
      defaultOptions: { pattern: "^@[a-z0-9][a-z0-9_-]*$" },
      examples: ["@BadTag"],
      documentation: "docs/rules.md#tag-pattern"
    },
    validateOptions: tagPatternOptions,
    run({ document, options, report }) {
      const pattern = new RegExp((options as { pattern: string }).pattern);
      const feature = document.feature;
      if (!feature) return;
      for (const tag of featureTags(feature)) {
        pattern.lastIndex = 0;
        if (pattern.test(tag.name)) continue;
        const column = tag.location.column ?? 1;
        report(rangeDiagnostic(document, tag.location.line, column, tag.name.length, "tag-pattern", `Tag ${tag.name} does not match ${pattern}.`));
      }
    }
  },

  "allowed-tags": {
    meta: {
      description: "Allow only listed tags and tags matching listed regular expressions.",
      category: "tags",
      recommended: false,
      defaultOptions: { tags: [], patterns: [] },
      examples: ["@unlisted"],
      documentation: "docs/rules.md#allowed-tags"
    },
    validateOptions: tagListOptions,
    run({ document, options, report }) {
      if (!document.feature) return;
      const allowed = tagMatcher(options);
      for (const tag of featureTags(document.feature)) {
        if (allowed(tag.name)) continue;
        report(rangeDiagnostic(document, tag.location.line, tag.location.column ?? 1, tag.name.length, "allowed-tags", `Tag ${tag.name} is not allowed.`));
      }
    }
  },

  "no-restricted-tags": {
    meta: {
      description: "Disallow listed tags and tags matching listed regular expressions.",
      category: "tags",
      recommended: false,
      defaultOptions: { tags: [], patterns: [] },
      examples: ["@wip"],
      documentation: "docs/rules.md#no-restricted-tags"
    },
    validateOptions: tagListOptions,
    run({ document, options, report }) {
      if (!document.feature) return;
      const restricted = tagMatcher(options);
      for (const tag of featureTags(document.feature)) {
        if (!restricted(tag.name)) continue;
        report(rangeDiagnostic(document, tag.location.line, tag.location.column ?? 1, tag.name.length, "no-restricted-tags", `Tag ${tag.name} is restricted.`));
      }
    }
  },

  "logical-keyword-order": {
    meta: {
      description: "Keep Given, When, and Then semantic stages in order.",
      category: "structure",
      recommended: false,
      examples: ["Then the user is signed in\nWhen the user opens the account page"],
      documentation: "docs/rules.md#logical-keyword-order"
    },
    run({ document, report }) {
      forEachScenario(document, (scenario) => {
        let stage = 0;
        for (const step of scenario.steps) {
          const type = step.keywordType;
          if (type === StepKeywordType.CONJUNCTION || type === StepKeywordType.UNKNOWN) continue;
          const next = type === StepKeywordType.CONTEXT ? 1 : type === StepKeywordType.ACTION ? 2 : type === StepKeywordType.OUTCOME ? 3 : 0;
          if (next < stage) {
            report(lineDiagnostic(document, step.location.line, "logical-keyword-order", `Step keyword stage moves backward from ${stageName(stage)} to ${stageName(next)}.`));
          } else {
            stage = Math.max(stage, next);
          }
        }
      });
    }
  },

  "no-trailing-whitespace": {
    meta: {
      description: "Disallow trailing spaces and tabs.",
      category: "formatting",
      recommended: false,
      fixable: true,
      examples: ["Feature: title   "],
      documentation: "docs/rules.md#no-trailing-whitespace"
    },
    run({ document, report }) {
      const protectedLines = docStringContentLines(document);
      for (let index = 0; index < document.lines.length; index += 1) {
        if (protectedLines.has(index + 1)) continue;
        const line = document.lines[index] ?? "";
        const match = line.match(/[\t ]+$/);
        if (!match || match.index === undefined) continue;
        const lineNumber = index + 1;
        const start = document.offsetAt({ line: lineNumber, column: match.index + 1 });
        const end = start + match[0].length;
        const fix: RuleFix = { range: [start, end], text: "" };
        report(rangeDiagnostic(document, lineNumber, match.index + 1, match[0].length, "no-trailing-whitespace", "Trailing whitespace.", fix));
      }
    }
  },

  "no-extra-blank-lines": {
    meta: {
      description: "Allow at most one consecutive empty line.",
      category: "formatting",
      recommended: false,
      fixable: true,
      examples: ["Feature: title\n\n\nScenario: one"],
      documentation: "docs/rules.md#no-extra-blank-lines"
    },
    run({ document, report }) {
      let blankCount = 0;
      const hasFinalNewline = /(?:\r\n|\n|\r)$/.test(document.source);
      const protectedLines = docStringContentLines(document);
      for (let index = 0; index < document.lines.length; index += 1) {
        const line = document.lines[index] ?? "";
        if (protectedLines.has(index + 1)) continue;
        if (hasFinalNewline && index === document.lines.length - 1) continue;
        if (line.trim().length > 0) {
          blankCount = 0;
          continue;
        }
        blankCount += 1;
        if (blankCount <= 1) continue;
        const lineNumber = index + 1;
        const range = document.rangeForLine(lineNumber);
        const newlineEnd = document.source.startsWith("\r\n", range[1]) ? range[1] + 2 : range[1] + (range[1] < document.source.length ? 1 : 0);
        const fix: RuleFix = { range: [range[0], newlineEnd], text: "" };
        report(rangeDiagnostic(document, lineNumber, 1, Math.max(1, line.length), "no-extra-blank-lines", "Unexpected consecutive blank line.", fix));
      }
    }
  },

  ...legacyRules
};

function stageName(stage: number): string {
  return stage === 1 ? "Given" : stage === 2 ? "When" : stage === 3 ? "Then" : "unknown";
}

export const projectRules: Readonly<Record<string, ProjectRuleModule<unknown>>> = {
  "no-duplicate-feature-names": {
    meta: {
      description: "Disallow duplicate Feature names across the lint target set.",
      category: "correctness",
      recommended: true,
      examples: ["Feature: Repeated title in a second file"],
      documentation: "docs/rules.md#no-duplicate-feature-names"
    },
    run({ documents, report }) {
      const seen = new Map<string, LintDocument>();
      for (const document of documents) {
        const feature = document.feature;
        if (!feature) continue;
        const key = feature.name.trim().toLowerCase();
        const first = seen.get(key);
        if (!first) {
          seen.set(key, document);
          continue;
        }
        report({
          filePath: document.filePath,
          ruleId: "no-duplicate-feature-names",
          severity: "error",
          message: `Feature name duplicates ${first.filePath}.`,
          start: { line: feature.location.line, column: feature.location.column ?? 1 },
          data: { duplicateOf: first.filePath }
        });
      }
    }
  },

  "no-duplicate-scenario-names": {
    meta: {
      description: "Disallow duplicate Scenario names within the same Feature or Rule.",
      category: "correctness",
      recommended: true,
      examples: ["Rule: Coupon\n  Scenario: apply\n  Scenario: apply"],
      documentation: "docs/rules.md#no-duplicate-scenario-names"
    },
    run({ documents, report }) {
      for (const document of documents) {
        const feature = document.feature;
        if (!feature) continue;
        const scopes: { label: string; scenarios: Scenario[] }[] = [
          { label: "Feature", scenarios: [] as Scenario[] }
        ];
        for (const child of feature.children) {
          if (child.scenario) scopes[0]?.scenarios.push(child.scenario);
          if (child.rule) {
            const scope = { label: `Rule ${child.rule.name || "(unnamed)"}`, scenarios: [] as Scenario[] };
            for (const nested of child.rule.children) if (nested.scenario) scope.scenarios.push(nested.scenario);
            scopes.push(scope);
          }
        }
        for (const scope of scopes) {
          const seen = new Set<string>();
          for (const scenario of scope.scenarios) {
            const name = scenario.name.trim().toLowerCase();
            if (!seen.has(name)) {
              seen.add(name);
              continue;
            }
            report({
              filePath: document.filePath,
              ruleId: "no-duplicate-scenario-names",
              severity: "error",
              message: `Scenario name duplicates another Scenario in the same ${scope.label}.`,
              start: { line: scenario.location.line, column: scenario.location.column ?? 1 }
            });
          }
        }
      }
    }
  }
};

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
