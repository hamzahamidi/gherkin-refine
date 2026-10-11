import type { Rule, Scenario } from "@cucumber/messages";
import type { RuleModule } from "../../types.js";
import { forEachScenario } from "../../parser/document.js";
import { keywordKey } from "./helpers.js";
import { lineDiagnostic, ruleDocs } from "../helpers.js";

export const structureRules: Readonly<Record<string, RuleModule<unknown>>> = {
  "no-unnamed-features": {
    meta: {
      description: "Require a Feature with a name.",
      category: "naming",
      recommended: false,
      examples: ["Feature:"],
      documentation: ruleDocs("no-unnamed-features")
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
      documentation: ruleDocs("no-unnamed-scenarios")
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
      documentation: ruleDocs("no-scenario-outlines-without-examples")
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
      documentation: ruleDocs("no-examples-in-scenarios")
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
      documentation: ruleDocs("no-empty-file")
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
      documentation: ruleDocs("no-files-without-scenarios")
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
      documentation: ruleDocs("no-empty-background")
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
      description: "Disallow a Background that applies to exactly one Scenario.",
      category: "structure",
      recommended: false,
      examples: ["Background: shared by one Scenario"],
      documentation: ruleDocs("no-background-only-scenario")
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
        if (background && scenarioCount(scope.children) === 1) {
          report(lineDiagnostic(document, background.location.line, "no-background-only-scenario", "Backgrounds are not allowed when there is just one scenario."));
        }
      }
    }
  },
};
