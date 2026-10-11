import type { Background, Scenario, Step, Tag } from "@cucumber/messages";
import type { RuleModule } from "../../types.js";
import { INDENTATION_DEFAULTS, INDENTATION_KEYS, indentationFix, keywordKey, tagsByLine } from "./helpers.js";
import { isRecord, lineDiagnostic, ruleDocs } from "../helpers.js";
import { defineRule } from "../define.js";

export const indentationRules: Readonly<Record<string, RuleModule<unknown>>> = {
  indentation: defineRule({
    meta: {
      description: "Require configured indentation for Feature, Background, Rule, Scenario, step, Examples, and tag lines; content inside a Rule is checked when `rule content` sets its extra indentation.",
      category: "formatting",
      recommended: false,
      fixable: true,
      defaultOptions: {},
      examples: ["   Scenario: shifted"],
      documentation: ruleDocs("indentation")
    },
    validateOptions: (value: unknown): value is Record<string, number> =>
      isRecord(value) && Object.entries(value).every(([key, level]) => INDENTATION_KEYS.has(key) && Number.isInteger(level) && Number(level) >= 0),
    run({ document, options, report }) {
      const feature = document.feature;
      if (!feature) return;
      const levels: Record<string, number> = { ...INDENTATION_DEFAULTS, ...options };
      levels["feature tag"] ??= levels.Feature as number;
      levels["scenario tag"] ??= levels.Scenario as number;
      const test = (location: { line: number; column?: number }, type: string, offset = 0) => {
        const column = location.column ?? 1;
        const expected = (levels[type] as number) + offset;
        if (column - 1 === expected) return;
        report({
          ...lineDiagnostic(document, location.line, "indentation", `Wrong indentation for "${type}", expected indentation level of ${expected}, but got ${column - 1}.`),
          fix: indentationFix(document, location.line, column, expected)
        });
      };
      const testSteps = (steps: readonly Step[], offset: number) => {
        for (const step of steps) {
          const key = keywordKey(step.keyword, document.language) ?? "";
          test(step.location, key in options ? key : "Step", offset);
        }
      };
      const testTags = (tags: readonly Tag[], type: string, offset = 0) => {
        for (const line of tagsByLine(tags)) if (line[0]) test(line[0].location, type, offset);
      };
      const testChild = (child: { background?: Background; scenario?: Scenario }, offset: number) => {
        if (child.background) {
          test(child.background.location, "Background", offset);
          testSteps(child.background.steps, offset);
        } else if (child.scenario) {
          test(child.scenario.location, "Scenario", offset);
          testTags(child.scenario.tags, "scenario tag", offset);
          testSteps(child.scenario.steps, offset);
          for (const examples of child.scenario.examples) {
            test(examples.location, "Examples", offset);
            if (!examples.tableHeader) continue;
            test(examples.tableHeader.location, "example", offset);
            for (const row of examples.tableBody) test(row.location, "example", offset);
          }
        }
      };
      const ruleContent = options["rule content"];
      test(feature.location, "Feature");
      testTags(feature.tags, "feature tag");
      for (const child of feature.children) {
        if (child.rule) {
          test(child.rule.location, "Rule");
          if (ruleContent === undefined) continue;
          for (const nested of child.rule.children) testChild(nested, ruleContent);
        } else {
          testChild(child, 0);
        }
      }
    }
  }),
};
