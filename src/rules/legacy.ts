import { dialects } from "@cucumber/gherkin";
import type { Examples, Feature, Rule, Scenario, Step, Tag } from "@cucumber/messages";
import { basename } from "node:path";
import { forEachScenario } from "../parser/document.js";
import type { LintDocument, RuleModule } from "../types.js";
import { featureTags, isRecord, lineDiagnostic, rangeDiagnostic } from "./helpers.js";

const INDENTATION_DEFAULTS: Readonly<Record<string, number>> = {
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
const INDENTATION_KEYS = new Set([...Object.keys(INDENTATION_DEFAULTS), "feature tag", "scenario tag"]);

const FILE_NAME_STYLES: Readonly<Record<string, (name: string) => string>> = {
  PascalCase: (name) => startCase(name).replace(/ /g, ""),
  "Title Case": (name) => startCase(name),
  camelCase: (name) => caseWords(name).reduce((result, word, index) => result + (index ? upperFirst(word.toLowerCase()) : word.toLowerCase()), ""),
  "kebab-case": (name) => caseWords(name).map((word) => word.toLowerCase()).join("-"),
  snake_case: (name) => caseWords(name).map((word) => word.toLowerCase()).join("_")
};

function keywordKey(keyword: string, language: string): string | undefined {
  const dialect = dialects[language] ?? dialects.en;
  for (const [key, values] of Object.entries(dialect ?? {})) {
    if (Array.isArray(values) && values.includes(keyword)) return key;
  }
  return undefined;
}

function nodeType(keyword: string, language: string): string {
  const types: Readonly<Record<string, string>> = { feature: "Feature", rule: "Rule", background: "Background", scenario: "Scenario", scenarioOutline: "Scenario Outline", examples: "Examples" };
  return types[keywordKey(keyword, language) ?? ""] ?? keyword;
}

function containers(feature: Feature): readonly Readonly<{ node: Feature | Rule; scenarios: readonly Scenario[] }>[] {
  const rules = feature.children.flatMap((child) => (child.rule ? [child.rule] : []));
  return [
    { node: feature, scenarios: feature.children.flatMap((child) => (child.scenario ? [child.scenario] : [])) },
    ...rules.map((rule) => ({ node: rule, scenarios: rule.children.flatMap((child) => (child.scenario ? [child.scenario] : [])) }))
  ];
}

function stepGroups(feature: Feature): readonly (readonly Step[])[] {
  return feature.children.flatMap((child) => [
    ...(child.background ? [child.background.steps] : []),
    ...(child.scenario ? [child.scenario.steps] : []),
    ...(child.rule?.children.flatMap((nested) => [
      ...(nested.background ? [nested.background.steps] : []),
      ...(nested.scenario ? [nested.scenario.steps] : [])
    ]) ?? [])
  ]);
}

function tagsByLine(tags: readonly Tag[]): readonly (readonly Tag[])[] {
  const lines = new Map<number, Tag[]>();
  for (const tag of tags) lines.set(tag.location.line, [...(lines.get(tag.location.line) ?? []), tag]);
  return [...lines.values()].map((line) => [...line].sort((left, right) => (left.location.column ?? 1) - (right.location.column ?? 1)));
}

function intersection(groups: readonly (readonly string[])[]): readonly string[] {
  const [first, ...rest] = groups;
  if (!first) return [];
  return [...new Set(first)].filter((name) => rest.every((group) => group.includes(name)));
}

function indentationFix(document: LintDocument, line: number, column: number, expected: number) {
  const start = document.offsetAt({ line, column: 1 });
  return { range: [start, start + column - 1] as const, text: " ".repeat(expected) };
}

function deburr(value: string): string {
  const special: Readonly<Record<string, string>> = {
    "Æ": "Ae", "æ": "ae", "Ð": "D", "ð": "d", "Ø": "O", "ø": "o", "Þ": "Th", "þ": "th", "ß": "ss",
    "Đ": "D", "đ": "d", "Ħ": "H", "ħ": "h", "ı": "i", "Ĳ": "IJ", "ĳ": "ij", "ĸ": "k", "Ŀ": "L",
    "ŀ": "l", "Ł": "L", "ł": "l", "ŉ": "'n", "Ŋ": "N", "ŋ": "n", "Œ": "Oe", "œ": "oe", "Ŧ": "T",
    "ŧ": "t", "ſ": "s"
  };
  return value
    .replace(/[\xc0-\xd6\xd8-\xf6\xf8-\xffĀ-ſ]/g, (char) => special[char] ?? char.normalize("NFD").replace(/[̀-ͯ]/g, ""))
    .replace(/[̀-ͯ︠-︯⃐-⃿]/g, "");
}

const BREAK = "\\xac\\xb1\\xd7\\xf7\\x00-\\x2f\\x3a-\\x40\\x5b-\\x60\\x7b-\\xbf\\u2000-\\u206f \\t\\x0b\\f\\xa0\\ufeff\\n\\r\\u2028\\u2029\\u1680\\u180e\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200a\\u202f\\u205f\\u3000";
const UPPER = "A-Z\\xc0-\\xd6\\xd8-\\xde";
const LOWER = "a-z\\xdf-\\xf6\\xf8-\\xff";
const MISC = `[^\\ud800-\\udfff${BREAK}\\d\\u2700-\\u27bf${LOWER}${UPPER}]`;
const MISC_LOWER = `(?:[${LOWER}]|${MISC})`;
const MISC_UPPER = `(?:[${UPPER}]|${MISC})`;
const UNICODE_WORD = new RegExp([
  `[${UPPER}]?[${LOWER}]+(?=[${BREAK}]|[${UPPER}]|$)`,
  `${MISC_UPPER}+(?=[${BREAK}]|[${UPPER}]${MISC_LOWER}|$)`,
  `[${UPPER}]?${MISC_LOWER}+`,
  `[${UPPER}]+`,
  "\\d*(?:1ST|2ND|3RD|(?![123])\\dTH)(?=\\b|[a-z_])",
  "\\d*(?:1st|2nd|3rd|(?![123])\\dth)(?=\\b|[A-Z_])",
  "\\d+",
  "(?:[\\u2700-\\u27bf]|(?:\\ud83c[\\udde6-\\uddff]){2}|[\\ud800-\\udbff][\\udc00-\\udfff])[\\ufe0e\\ufe0f]?(?:[\\u0300-\\u036f\\ufe20-\\ufe2f\\u20d0-\\u20ff]|\\ud83c[\\udffb-\\udfff])?(?:\\u200d(?:[^\\ud800-\\udfff]|(?:\\ud83c[\\udde6-\\uddff]){2}|[\\ud800-\\udbff][\\udc00-\\udfff])[\\ufe0e\\ufe0f]?(?:[\\u0300-\\u036f\\ufe20-\\ufe2f\\u20d0-\\u20ff]|\\ud83c[\\udffb-\\udfff])?)*"
].join("|"), "g");

const ASCII_WORD = /[0-9A-Za-z\u0080-\uffff]+/g;

// Mirrors lodash words(), which gherkin-lint's file-name rule uses to build the expected name.
function caseWords(value: string): string[] {
  const source = deburr(value).replace(/['’]/g, "");
  if (/[a-z][A-Z]|[A-Z]{2}[a-z]|[0-9][a-zA-Z]|[a-zA-Z][0-9]|[^a-zA-Z0-9 ]/.test(source)) return source.match(UNICODE_WORD) ?? [];
  return source.match(ASCII_WORD) ?? [];
}

function upperFirst(value: string): string {
  const [first = "", ...rest] = [...value];
  return first.toUpperCase() + rest.join("");
}

function startCase(value: string): string {
  return caseWords(value).map(upperFirst).join(" ");
}

export const legacyRules: Readonly<Record<string, RuleModule<unknown>>> = {
  "no-unnamed-features": {
    meta: {
      description: "Require a Feature with a name.",
      category: "naming",
      recommended: false,
      examples: ["Feature:"],
      documentation: "docs/rules.md#no-unnamed-features"
    },
    run({ document, report }) {
      if (document.feature?.name) return;
      report(lineDiagnostic(document, document.feature?.location.line ?? 1, "no-unnamed-features", "Missing Feature name."));
    }
  },

  "no-unnamed-scenarios": {
    meta: {
      description: "Require every Scenario to have a name.",
      category: "naming",
      recommended: false,
      examples: ["Scenario:"],
      documentation: "docs/rules.md#no-unnamed-scenarios"
    },
    run({ document, report }) {
      forEachScenario(document, (scenario) => {
        if (!scenario.name) report(lineDiagnostic(document, scenario.location.line, "no-unnamed-scenarios", "Missing Scenario name."));
      });
    }
  },

  "no-scenario-outlines-without-examples": {
    meta: {
      description: "Require Scenario Outlines to have Examples rows.",
      category: "correctness",
      recommended: false,
      examples: ["Scenario Outline: never runs"],
      documentation: "docs/rules.md#no-scenario-outlines-without-examples"
    },
    run({ document, report }) {
      forEachScenario(document, (scenario) => {
        if (keywordKey(scenario.keyword, document.language) !== "scenarioOutline") return;
        if (scenario.examples.some((examples) => examples.tableBody.length > 0)) return;
        report(lineDiagnostic(document, scenario.location.line, "no-scenario-outlines-without-examples", "Scenario Outline does not have any Examples."));
      });
    }
  },

  "no-examples-in-scenarios": {
    meta: {
      description: "Disallow Examples under a Scenario keyword instead of a Scenario Outline keyword.",
      category: "structure",
      recommended: false,
      examples: ["Scenario: with Examples"],
      documentation: "docs/rules.md#no-examples-in-scenarios"
    },
    run({ document, report }) {
      forEachScenario(document, (scenario) => {
        if (keywordKey(scenario.keyword, document.language) !== "scenario" || scenario.examples.length === 0) return;
        report(lineDiagnostic(document, scenario.location.line, "no-examples-in-scenarios", "Cannot use \"Examples\" in a \"Scenario\", use a \"Scenario Outline\" instead."));
      });
    }
  },

  "no-empty-file": {
    meta: {
      description: "Disallow files without a Feature.",
      category: "correctness",
      recommended: false,
      examples: ["# only a comment"],
      documentation: "docs/rules.md#no-empty-file"
    },
    run({ document, report }) {
      if (!document.feature) report(lineDiagnostic(document, 1, "no-empty-file", "Empty feature files are disallowed."));
    }
  },

  "no-files-without-scenarios": {
    meta: {
      description: "Require a Feature to contain at least one Scenario.",
      category: "correctness",
      recommended: false,
      examples: ["Feature: nothing to run"],
      documentation: "docs/rules.md#no-files-without-scenarios"
    },
    run({ document, report }) {
      const feature = document.feature;
      if (!feature) return;
      const hasScenario = feature.children.some((child) => child.scenario || child.rule?.children.some((nested) => nested.scenario));
      if (!hasScenario) report(lineDiagnostic(document, 1, "no-files-without-scenarios", "Feature file does not have any Scenarios."));
    }
  },

  "no-empty-background": {
    meta: {
      description: "Disallow Backgrounds without steps.",
      category: "correctness",
      recommended: false,
      examples: ["Background:"],
      documentation: "docs/rules.md#no-empty-background"
    },
    run({ document, report }) {
      const feature = document.feature;
      if (!feature) return;
      const backgrounds = feature.children.flatMap((child) => [
        ...(child.background ? [child.background] : []),
        ...(child.rule?.children.flatMap((nested) => (nested.background ? [nested.background] : [])) ?? [])
      ]);
      for (const background of backgrounds) {
        if (background.steps.length === 0) report(lineDiagnostic(document, background.location.line, "no-empty-background", "Empty backgrounds are not allowed."));
      }
    }
  },

  "no-background-only-scenario": {
    meta: {
      description: "Disallow a Background that applies to a single Scenario.",
      category: "structure",
      recommended: false,
      examples: ["Background: shared by one Scenario"],
      documentation: "docs/rules.md#no-background-only-scenario"
    },
    run({ document, report }) {
      const feature = document.feature;
      if (!feature) return;
      const scenarioCount = (children: readonly { scenario?: Scenario; rule?: Rule }[]): number =>
        children.reduce((count, child) => count + (child.scenario ? 1 : 0) + (child.rule ? scenarioCount(child.rule.children) : 0), 0);
      const scopes = [
        { children: feature.children },
        ...feature.children.flatMap((child) => (child.rule ? [{ children: child.rule.children }] : []))
      ];
      for (const scope of scopes) {
        const background = scope.children.find((child) => child.background)?.background;
        if (background && scenarioCount(scope.children) <= 1) {
          report(lineDiagnostic(document, background.location.line, "no-background-only-scenario", "Backgrounds are not allowed when there is just one scenario."));
        }
      }
    }
  },

  "no-partially-commented-tag-lines": {
    meta: {
      description: "Disallow comments after tags on a tag line.",
      category: "tags",
      recommended: false,
      examples: ["@smoke # @wip"],
      documentation: "docs/rules.md#no-partially-commented-tag-lines"
    },
    run({ document, report }) {
      if (!document.feature) return;
      for (const tags of tagsByLine(featureTags(document.feature))) {
        const last = tags[tags.length - 1];
        if (!last) continue;
        const line = document.lines[last.location.line - 1] ?? "";
        const rest = line.slice((last.location.column ?? 1) - 1 + last.name.length);
        if (tags.some((tag) => tag.name.indexOf("#") > 0) || rest.trimStart().startsWith("#")) {
          report(lineDiagnostic(document, last.location.line, "no-partially-commented-tag-lines", "Partially commented tag lines not allowed."));
        }
      }
    }
  },

  "one-space-between-tags": {
    meta: {
      description: "Require exactly one space between tags on the same line.",
      category: "formatting",
      recommended: false,
      fixable: true,
      examples: ["@smoke   @wip"],
      documentation: "docs/rules.md#one-space-between-tags"
    },
    run({ document, report }) {
      if (!document.feature) return;
      for (const tags of tagsByLine(featureTags(document.feature))) {
        for (let index = 0; index + 1 < tags.length; index += 1) {
          const current = tags[index] as Tag;
          const next = tags[index + 1] as Tag;
          const end = (current.location.column ?? 1) + current.name.length;
          const nextColumn = next.location.column ?? 1;
          if (end >= nextColumn - 1) continue;
          const start = document.offsetAt({ line: current.location.line, column: end });
          report(rangeDiagnostic(document, current.location.line, end, nextColumn - end, "one-space-between-tags",
            `There is more than one space between the tags ${current.name} and ${next.name}.`,
            { range: [start, start + nextColumn - end], text: " " }));
        }
      }
    }
  },

  "no-superfluous-tags": {
    meta: {
      description: "Disallow tags that repeat a tag of an enclosing Feature, Rule, or Scenario.",
      category: "tags",
      recommended: false,
      examples: ["@smoke Feature with @smoke Scenario"],
      documentation: "docs/rules.md#no-superfluous-tags"
    },
    run({ document, report }) {
      const feature = document.feature;
      if (!feature) return;
      const check = (child: { keyword: string; tags: readonly Tag[] }, parent: { keyword: string; tags: readonly Tag[] }) => {
        const parentNames = new Set(parent.tags.map((tag) => tag.name));
        const seen = new Set<string>();
        for (const tag of child.tags) {
          if (!parentNames.has(tag.name) || seen.has(tag.name)) continue;
          seen.add(tag.name);
          report(lineDiagnostic(document, tag.location.line, "no-superfluous-tags",
            `Tag duplication between ${nodeType(child.keyword, document.language)} and its corresponding ${nodeType(parent.keyword, document.language)}: ${tag.name}.`));
        }
      };
      const checkScenario = (scenario: Scenario, parents: readonly { keyword: string; tags: readonly Tag[] }[]) => {
        for (const parent of parents) check(scenario, parent);
        for (const examples of scenario.examples as readonly Examples[]) {
          for (const parent of [...parents, scenario]) check(examples, parent);
        }
      };
      for (const child of feature.children) {
        if (child.scenario) checkScenario(child.scenario, [feature]);
        if (child.rule) {
          check(child.rule, feature);
          for (const nested of child.rule.children) {
            if (nested.scenario) checkScenario(nested.scenario, [feature, child.rule]);
          }
        }
      }
    }
  },

  "no-homogenous-tags": {
    meta: {
      description: "Disallow a tag on every Scenario or every Examples block where it belongs on the parent.",
      category: "tags",
      recommended: false,
      examples: ["@smoke on every Scenario"],
      documentation: "docs/rules.md#no-homogenous-tags"
    },
    run({ document, report }) {
      const feature = document.feature;
      if (!feature) return;
      for (const { node, scenarios } of containers(feature)) {
        for (const scenario of scenarios) {
          const shared = intersection(scenario.examples.map((examples) => examples.tags.map((tag) => tag.name)));
          if (shared.length > 0) {
            report(lineDiagnostic(document, scenario.location.line, "no-homogenous-tags",
              `All Examples of a Scenario Outline have the same tag(s), they should be defined on the Scenario Outline instead: ${shared.join(", ")}.`));
          }
        }
        const shared = intersection(scenarios.map((scenario) => scenario.tags.map((tag) => tag.name)));
        if (shared.length > 0) {
          const parent = node === feature ? "Feature" : "Rule";
          report(lineDiagnostic(document, node.location.line, "no-homogenous-tags",
            `All Scenarios on this ${parent} have the same tag(s), they should be defined on the ${parent} instead: ${shared.join(", ")}.`));
        }
      }
    }
  },

  "use-and": {
    meta: {
      description: "Require And instead of repeating the previous step keyword.",
      category: "formatting",
      recommended: false,
      fixable: true,
      examples: ["Given a cart\nGiven a coupon"],
      documentation: "docs/rules.md#use-and"
    },
    run({ document, report }) {
      if (!document.feature) return;
      const andKeyword = dialects[document.language]?.and.find((keyword) => keyword.trim() !== "*") ?? "And ";
      for (const steps of stepGroups(document.feature)) {
        let previous: string | undefined;
        for (const step of steps) {
          const key = keywordKey(step.keyword, document.language);
          if (key === "and") continue;
          if (key === previous) {
            const column = step.location.column ?? 1;
            const start = document.offsetAt({ line: step.location.line, column });
            report(rangeDiagnostic(document, step.location.line, column, step.keyword.length, "use-and",
              `Step "${step.keyword}${step.text}" should use And instead of ${step.keyword.trim()}.`,
              { range: [start, start + step.keyword.length], text: andKeyword }));
          }
          previous = key;
        }
      }
    }
  },

  indentation: {
    meta: {
      description: "Require configured indentation for Feature, Background, Rule, Scenario, step, Examples, and tag lines.",
      category: "formatting",
      recommended: false,
      fixable: true,
      defaultOptions: {},
      examples: ["   Scenario: shifted"],
      documentation: "docs/rules.md#indentation"
    },
    validateOptions: (value: unknown): value is Record<string, number> =>
      isRecord(value) && Object.entries(value).every(([key, level]) => INDENTATION_KEYS.has(key) && Number.isInteger(level) && Number(level) >= 0),
    run({ document, options, report }) {
      const feature = document.feature;
      if (!feature) return;
      const configured = options as Readonly<Record<string, number>>;
      const levels: Record<string, number> = { ...INDENTATION_DEFAULTS, ...configured };
      levels["feature tag"] ??= levels.Feature as number;
      levels["scenario tag"] ??= levels.Scenario as number;
      const test = (location: { line: number; column?: number }, type: string) => {
        const column = location.column ?? 1;
        const expected = levels[type] as number;
        if (column - 1 === expected) return;
        report({
          ...lineDiagnostic(document, location.line, "indentation", `Wrong indentation for "${type}", expected indentation level of ${expected}, but got ${column - 1}.`),
          fix: indentationFix(document, location.line, column, expected)
        });
      };
      const testSteps = (steps: readonly Step[]) => {
        for (const step of steps) {
          const key = keywordKey(step.keyword, document.language) ?? "";
          test(step.location, key in configured ? key : "Step");
        }
      };
      const testTags = (tags: readonly Tag[], type: string) => {
        for (const line of tagsByLine(tags)) if (line[0]) test(line[0].location, type);
      };
      test(feature.location, "Feature");
      testTags(feature.tags, "feature tag");
      for (const child of feature.children) {
        if (child.rule) {
          test(child.rule.location, "Rule");
        } else if (child.background) {
          test(child.background.location, "Background");
          testSteps(child.background.steps);
        } else if (child.scenario) {
          test(child.scenario.location, "Scenario");
          testTags(child.scenario.tags, "scenario tag");
          testSteps(child.scenario.steps);
          for (const examples of child.scenario.examples) {
            test(examples.location, "Examples");
            if (!examples.tableHeader) continue;
            test(examples.tableHeader.location, "example");
            for (const row of examples.tableBody) test(row.location, "example");
          }
        }
      }
    }
  },

  "new-line-at-eof": {
    meta: {
      description: "Require or disallow a line break at the end of the file.",
      category: "formatting",
      recommended: false,
      fixable: true,
      defaultOptions: "yes",
      examples: ["Feature: no final line break"],
      documentation: "docs/rules.md#new-line-at-eof"
    },
    validateOptions: (value: unknown): value is "yes" | "no" => value === "yes" || value === "no",
    run({ document, options, report }) {
      const hasLineBreak = document.lines[document.lines.length - 1] === "";
      const line = document.lines.length;
      if (!hasLineBreak && options === "yes") {
        report({ ...lineDiagnostic(document, line, "new-line-at-eof", "New line at EOF(end of file) is required."), fix: { range: [document.source.length, document.source.length], text: "\n" } });
      } else if (hasLineBreak && options === "no") {
        const trailing = document.source.match(/(?:\r\n|\n|\r)+$/)?.[0] ?? "";
        report({ ...lineDiagnostic(document, line, "new-line-at-eof", "New line at EOF(end of file) is not allowed."), fix: { range: [document.source.length - trailing.length, document.source.length], text: "" } });
      }
    }
  },

  "file-name": {
    meta: {
      description: "Require feature file names in a configured case style.",
      category: "naming",
      recommended: false,
      defaultOptions: { style: "PascalCase" },
      examples: ["checkout_flow.feature with PascalCase"],
      documentation: "docs/rules.md#file-name"
    },
    validateOptions: (value: unknown): value is { style: string } =>
      isRecord(value) && Object.keys(value).every((key) => key === "style") && (value.style === undefined || (typeof value.style === "string" && value.style in FILE_NAME_STYLES)),
    run({ document, options, report }) {
      const style = (options as { style?: string }).style ?? "PascalCase";
      const name = basename(document.filePath.replaceAll("\\", "/"), ".feature");
      const expected = (FILE_NAME_STYLES[style] as (value: string) => string)(name);
      if (name !== expected) report(lineDiagnostic(document, 1, "file-name", `File names should be written in ${style} e.g. "${expected}.feature".`));
    }
  }
};
