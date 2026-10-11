import type { Scenario } from "@cucumber/messages";
import type { LintDocument, ProjectRuleModule } from "../../types.js";
import { forEachScenario } from "../../parser/document.js";
import { ruleDocs } from "../helpers.js";
import { duplicateScenarioOptions } from "./helpers.js";

export const projectRules: Readonly<Record<string, ProjectRuleModule<unknown>>> = {
  "no-duplicate-feature-names": {
    meta: {
      description: "Disallow duplicate Feature names across the lint target set.",
      category: "correctness",
      recommended: true,
      examples: ["Feature: Repeated title in a second file"],
      documentation: ruleDocs("no-duplicate-feature-names")
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
      documentation: ruleDocs("no-duplicate-scenario-names")
    },
    validateOptions: duplicateScenarioOptions,
    run({ documents, options, report }) {
      if ((options as { scope?: string }).scope === "anywhere") {
        const seen = new Map<string, { filePath: string; line: number }>();
        for (const document of documents) {
          forEachScenario(document, (scenario) => {
            const name = scenario.name.trim().toLowerCase();
            const first = seen.get(name);
            if (!first) {
              seen.set(name, { filePath: document.filePath, line: scenario.location.line });
              return;
            }
            report({
              filePath: document.filePath,
              ruleId: "no-duplicate-scenario-names",
              severity: "error",
              message: `Scenario name duplicates ${first.filePath}:${first.line}.`,
              start: { line: scenario.location.line, column: scenario.location.column ?? 1 }
            });
          });
        }
        return;
      }
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
  },
};
