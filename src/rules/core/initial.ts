import type { RuleModule } from "../../types.js";
import { forEachScenario } from "../../parser/document.js";
import { defineRule } from "../define.js";
import { DOCS_URL, lineDiagnostic, rangeDiagnostic, ruleDocs } from "../helpers.js";
import { featureSizeOptions, outlinePlaceholders, scenarioSizeOptions, tagGroups } from "./helpers.js";

export const initialRules: Readonly<Record<string, RuleModule<unknown>>> = {
  "unused-disable-directive": {
    meta: {
      description: "Report suppression comments that suppress no diagnostics when reporting is enabled.",
      category: "correctness",
      recommended: false,
      examples: ["# gherkin-refine-disable-next-line name-length -- legacy title"],
      documentation: `${DOCS_URL}/configuration#inline-suppression`
    },
    run() {}
  },

  "no-duplicate-tags": {
    meta: {
      description: "Disallow duplicate tags on the same Gherkin element.",
      category: "correctness",
      recommended: true,
      examples: ["Feature: Login\n  @smoke @smoke\n  Scenario: valid login"],
      documentation: ruleDocs("no-duplicate-tags")
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
      description: "Disallow Scenario Outline variables that are never used in the title, steps or arguments.",
      category: "correctness",
      recommended: true,
      examples: ["Scenario Outline: lookup\n  Given <id> exists\n  Examples:\n    | id | unused |"],
      documentation: ruleDocs("no-unused-outline-variables")
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
      documentation: ruleDocs("no-undefined-outline-variables")
    },
    run({ document, report }) {
      forEachScenario(document, (scenario) => {
        if (!scenario.examples.length) return;
        const declared = scenario.examples.map((examples) => new Set((examples.tableHeader?.cells ?? []).map((cell) => cell.value)));
        const sources = [
          { location: scenario.location, values: [scenario.name] },
          ...scenario.steps.map((step) => ({ location: step.location, values: [
            step.text,
            ...(step.docString ? [step.docString.content] : []),
            ...(step.dataTable?.rows.flatMap((row) => row.cells.map((cell) => cell.value)) ?? [])
          ] }))
        ];
        for (const { location, values } of sources) {
          let cursor = document.offsetAt({ line: location.line, column: location.column ?? 1 });
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

  "scenario-size": defineRule({
    meta: {
      description: "Limit the number of steps in a Scenario.",
      category: "structure",
      recommended: false,
      defaultOptions: { maxSteps: 12 },
      examples: ["Scenario: long flow\n  Given one\n  When two\n  Then three"],
      documentation: ruleDocs("scenario-size")
    },
    validateOptions: scenarioSizeOptions,
    run({ document, options, report }) {
      forEachScenario(document, (scenario) => {
        if (scenario.steps.length <= options.maxSteps) return;
        const line = scenario.location.line;
        report(lineDiagnostic(document, line, "scenario-size", `Scenario contains ${scenario.steps.length} steps; configured maximum is ${options.maxSteps}.`));
      });
    }
  }),

  "background-size": defineRule({
    meta: {
      description: "Limit the number of steps in Feature and Rule Backgrounds.",
      category: "structure",
      recommended: false,
      defaultOptions: { maxSteps: 5 },
      examples: ["Rule: Coupon\n  Background:\n    Given many shared steps"],
      documentation: ruleDocs("background-size")
    },
    validateOptions: scenarioSizeOptions,
    run({ document, options, report }) {
      const { maxSteps } = options;
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
  }),

  "feature-size": defineRule({
    meta: {
      description: "Limit the number of Scenarios in a Feature, including Scenarios under Rules, optionally counting each Examples row.",
      category: "structure",
      recommended: false,
      defaultOptions: { maxScenarios: 20 },
      examples: ["Feature: Large workflow with more than the configured number of scenarios"],
      documentation: ruleDocs("feature-size")
    },
    validateOptions: featureSizeOptions,
    run({ document, options, report }) {
      const feature = document.feature;
      if (!feature) return;
      const { maxScenarios, countOutlineExamples = false } = options;
      let count = 0;
      forEachScenario(document, (scenario) => {
        count += countOutlineExamples && scenario.examples.length > 0
          ? scenario.examples.reduce((rows, examples) => rows + examples.tableBody.length, 0)
          : 1;
      });
      if (count > maxScenarios) {
        report(lineDiagnostic(document, feature.location.line, "feature-size", `Feature contains ${count} Scenarios; configured maximum is ${maxScenarios}.`));
      }
    }
  }),
};
