import type { Background, Feature, Rule, Scenario } from "@cucumber/messages";
import type { RuleModule } from "../../types.js";
import { basename } from "node:path";
import { forEachScenario } from "../../parser/document.js";
import { FILE_NAME_STYLES } from "./case-style.js";
import { isValidPattern, keywordKey, nodeType, RESTRICTED_PATTERN_KEYS } from "./helpers.js";
import { isRecord, isStringArray, lineDiagnostic, ruleDocs } from "../helpers.js";
import { defineRule } from "../define.js";

export const metadataRules: Readonly<Record<string, RuleModule<unknown>>> = {
  "required-tags": defineRule({
    meta: {
      description: "Require every Scenario to have a tag matching each configured regular expression.",
      category: "tags",
      recommended: false,
      defaultOptions: { tags: [], ignoreUntagged: true },
      examples: ["Scenario without a @jira-123 tag"],
      documentation: ruleDocs("required-tags")
    },
    validateOptions: (value: unknown): value is { tags?: string[]; ignoreUntagged?: boolean } =>
      isRecord(value) && Object.keys(value).every((key) => key === "tags" || key === "ignoreUntagged")
      && (value.ignoreUntagged === undefined || typeof value.ignoreUntagged === "boolean")
      && (value.tags === undefined || (isStringArray(value.tags) && value.tags.every(isValidPattern))),
    run({ document, options, report }) {
      const { tags = [], ignoreUntagged = true } = options;
      const required = tags.map((pattern) => [pattern, new RegExp(pattern)] as const);
      forEachScenario(document, (scenario) => {
        if (ignoreUntagged && scenario.tags.length === 0) return;
        for (const [pattern, expression] of required) {
          if (scenario.tags.some((tag) => expression.test(tag.name))) continue;
          report(lineDiagnostic(document, scenario.location.line, "required-tags", `No tag found matching ${pattern} for ${nodeType(scenario.keyword, document.language)}.`));
        }
      });
    }
  }),

  "no-restricted-patterns": defineRule({
    meta: {
      description: "Disallow case-insensitive regular expressions in Feature, Background, and Scenario names, descriptions, and steps.",
      category: "naming",
      recommended: false,
      defaultOptions: {},
      examples: ["Scenario: TODO write this"],
      documentation: ruleDocs("no-restricted-patterns")
    },
    validateOptions: (value: unknown): value is Readonly<Record<string, string[]>> =>
      isRecord(value) && Object.entries(value).every(([key, patterns]) => RESTRICTED_PATTERN_KEYS.has(key) && isStringArray(patterns) && patterns.every(isValidPattern)),
    run({ document, options, report }) {
      const feature = document.feature;
      if (!feature) return;
      const compile = (key: string) => [...(options[key] ?? []), ...(options.Global ?? [])].map((pattern) => new RegExp(pattern, "i"));
      const patterns: Readonly<Record<string, readonly RegExp[]>> = {
        feature: compile("Feature"), background: compile("Background"), scenario: compile("Scenario"), scenarioOutline: compile("ScenarioOutline"), rule: compile("Rule")
      };
      const check = (node: { keyword: string; location: { line: number } }, property: "name" | "description" | "text", value: string, expressions: readonly RegExp[]) => {
        if (!value) return;
        const lines = property === "description" ? value.split("\n") : [value];
        for (const expression of expressions) {
          for (const line of lines) {
            if (!expression.test(line.trim())) continue;
            const type = property === "text" ? "Step" : nodeType(node.keyword, document.language);
            report(lineDiagnostic(document, node.location.line, "no-restricted-patterns", `${type} ${property}: "${line.trim()}" matches restricted pattern "${expression}".`));
          }
        }
      };
      const checkNode = (node: Feature | Rule | Background | Scenario) => {
        const expressions = patterns[keywordKey(node.keyword, document.language) ?? ""] ?? [];
        check(node, "name", node.name, expressions);
        check(node, "description", node.description, expressions);
        if ("steps" in node) for (const step of node.steps) check(step, "text", step.text, expressions);
      };
      checkNode(feature);
      for (const child of feature.children) {
        const node = child.background ?? child.scenario ?? child.rule;
        if (node) checkNode(node);
        for (const nested of child.rule?.children ?? []) {
          const inner = nested.background ?? nested.scenario;
          if (inner) checkNode(inner);
        }
      }
    }
  }),

  "only-one-when": {
    meta: {
      description: "Allow at most one When step per Scenario.",
      category: "structure",
      recommended: false,
      examples: ["When I pay\nWhen I cancel"],
      documentation: ruleDocs("only-one-when")
    },
    run({ document, report }) {
      forEachScenario(document, (scenario) => {
        const whens = scenario.steps.filter((step) => keywordKey(step.keyword, document.language) === "when");
        const second = whens[1];
        if (!second) return;
        report(lineDiagnostic(document, second.location.line, "only-one-when", `Scenario "${scenario.name}" contains ${whens.length} When statements (max 1).`));
      });
    }
  },

  "file-name": defineRule({
    meta: {
      description: "Require feature file names in a configured case style.",
      category: "naming",
      recommended: false,
      defaultOptions: { style: "PascalCase" },
      examples: ["checkout_flow.feature with PascalCase"],
      documentation: ruleDocs("file-name")
    },
    validateOptions: (value: unknown): value is { style?: string } =>
      isRecord(value) && Object.keys(value).every((key) => key === "style") && (value.style === undefined || (typeof value.style === "string" && value.style in FILE_NAME_STYLES)),
    run({ document, options, report }) {
      const style = options.style ?? "PascalCase";
      const name = basename(document.filePath.replaceAll("\\", "/"), ".feature");
      const expected = (FILE_NAME_STYLES[style] as (value: string) => string)(name);
      if (name !== expected) report(lineDiagnostic(document, 1, "file-name", `File names should be written in ${style} e.g. "${expected}.feature".`));
    }
  }),
};
