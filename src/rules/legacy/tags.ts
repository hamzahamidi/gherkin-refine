import type { Examples, Scenario, Tag } from "@cucumber/messages";
import type { RuleModule } from "../../types.js";
import { containers, intersection, nodeType, tagsByLine } from "./helpers.js";
import { featureTags, lineDiagnostic, rangeDiagnostic, ruleDocs } from "../helpers.js";

export const tagsRules: Readonly<Record<string, RuleModule<unknown>>> = {
  "no-partially-commented-tag-lines": {
    meta: {
      description: "Disallow comments after tags on a tag line.",
      category: "tags",
      recommended: false,
      examples: ["@smoke # @wip"],
      documentation: ruleDocs("no-partially-commented-tag-lines")
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
      documentation: ruleDocs("one-space-between-tags")
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
      documentation: ruleDocs("no-superfluous-tags")
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

  "no-homogeneous-tags": {
    meta: {
      description: "Disallow a tag on every one of two or more Scenarios or Examples blocks where it belongs on the parent.",
      category: "tags",
      recommended: false,
      examples: ["@smoke on every Scenario"],
      documentation: ruleDocs("no-homogeneous-tags")
    },
    run({ document, report }) {
      const feature = document.feature;
      if (!feature) return;
      for (const { node, scenarios } of containers(feature)) {
        for (const scenario of scenarios) {
          if (scenario.examples.length < 2) continue;
          for (const tag of intersection(scenario.examples.map((examples) => examples.tags.map((item) => item.name)))) {
            report(lineDiagnostic(document, scenario.location.line, "no-homogeneous-tags",
              `Tag ${tag} is on every Examples block of this Scenario Outline; define it on the Scenario Outline instead.`));
          }
        }
        if (scenarios.length < 2) continue;
        const parent = node === feature ? "Feature" : "Rule";
        for (const tag of intersection(scenarios.map((scenario) => scenario.tags.map((item) => item.name)))) {
          report(lineDiagnostic(document, node.location.line, "no-homogeneous-tags", `Tag ${tag} is on every Scenario of this ${parent}; define it on the ${parent} instead.`));
        }
      }
    }
  },
};
