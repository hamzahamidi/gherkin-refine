import type { Feature, Scenario } from "@cucumber/messages";
import type { Diagnostic, LintDocument, ProjectRuleModule } from "../../types.js";
import { forEachScenario } from "../../parser/document.js";
import { ruleDocs } from "../helpers.js";
import { duplicateScenarioOptions, type DuplicateScenarioOptions } from "./helpers.js";

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
    ...duplicateScenarioOptions,
    run({ documents, options, report }) {
      if (options.scope === "anywhere") reportDuplicatesAnywhere(documents, report);
      else reportDuplicatesPerScope(documents, report);
    }
  } satisfies ProjectRuleModule<DuplicateScenarioOptions>,
};

type Report = (diagnostic: Diagnostic) => void;

function reportDuplicatesAnywhere(documents: readonly LintDocument[], report: Report): void {
  const seen = new Map<string, { filePath: string; line: number }>();
  for (const document of documents) {
    forEachScenario(document, (scenario) => {
      const name = scenarioKey(scenario);
      const first = seen.get(name);
      if (!first) {
        seen.set(name, { filePath: document.filePath, line: scenario.location.line });
        return;
      }
      report(duplicateScenario(document, scenario, `Scenario name duplicates ${first.filePath}:${first.line}.`));
    });
  }
}

function reportDuplicatesPerScope(documents: readonly LintDocument[], report: Report): void {
  for (const document of documents) {
    if (!document.feature) continue;
    for (const scope of scenarioScopes(document.feature)) {
      const seen = new Set<string>();
      for (const scenario of scope.scenarios) {
        const name = scenarioKey(scenario);
        if (!seen.has(name)) {
          seen.add(name);
          continue;
        }
        report(duplicateScenario(document, scenario, `Scenario name duplicates another Scenario in the same ${scope.label}.`));
      }
    }
  }
}

function scenarioScopes(feature: Feature): { label: string; scenarios: Scenario[] }[] {
  const featureScope = { label: "Feature", scenarios: [] as Scenario[] };
  const ruleScopes = [];
  for (const child of feature.children) {
    if (child.scenario) featureScope.scenarios.push(child.scenario);
    if (child.rule) {
      const scenarios = child.rule.children.flatMap((nested) => nested.scenario ? [nested.scenario] : []);
      ruleScopes.push({ label: `Rule ${child.rule.name || "(unnamed)"}`, scenarios });
    }
  }
  return [featureScope, ...ruleScopes];
}

function scenarioKey(scenario: Scenario): string {
  return scenario.name.trim().toLowerCase();
}

function duplicateScenario(document: LintDocument, scenario: Scenario, message: string): Diagnostic {
  return {
    filePath: document.filePath,
    ruleId: "no-duplicate-scenario-names",
    severity: "error",
    message,
    start: { line: scenario.location.line, column: scenario.location.column ?? 1 }
  };
}
