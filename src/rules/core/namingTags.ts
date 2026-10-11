import type { RuleModule } from "../../types.js";
import { forEachScenario, forEachStep } from "../../parser/document.js";
import { featureTags, lineDiagnostic, rangeDiagnostic, ruleDocs } from "../helpers.js";
import { nameLengthOptions, tagListOptions, tagMatcher, tagPatternOptions } from "./helpers.js";

export const namingTagsRules: Readonly<Record<string, RuleModule<unknown>>> = {
  "name-length": {
    meta: {
      description: "Limit Feature and Scenario name length, or Feature, Rule, Scenario, and Step lengths separately.",
      category: "naming",
      recommended: false,
      defaultOptions: { max: 80 },
      examples: ["Scenario: A name longer than the configured maximum"],
      documentation: ruleDocs("name-length")
    },
    validateOptions: nameLengthOptions,
    run({ document, options, report }) {
      const feature = document.feature;
      if (!feature) return;
      const configured = options as Readonly<Record<string, number>>;
      // { max } keeps the original Feature and Scenario check; per-node limits follow gherkin-lint, defaulting to 70.
      const limits: Readonly<Record<string, number | undefined>> = "max" in configured
        ? { Feature: configured.max, Scenario: configured.max }
        : { Feature: 70, Rule: 70, Scenario: 70, Step: 70, ...configured };
      const check = (type: string, label: string, value: string, line: number) => {
        const max = limits[type];
        if (max !== undefined && value.length > max) report(lineDiagnostic(document, line, "name-length", `${type} ${label} has ${value.length} characters; configured maximum is ${max}.`));
      };
      check("Feature", "name", feature.name, feature.location.line);
      for (const child of feature.children) if (child.rule) check("Rule", "name", child.rule.name, child.rule.location.line);
      forEachScenario(document, (scenario) => check("Scenario", "name", scenario.name, scenario.location.line));
      forEachStep(document, (step) => check("Step", "text", step.text, step.location.line));
    }
  },

  "tag-pattern": {
    meta: {
      description: "Require tags to match a configured regular expression.",
      category: "tags",
      recommended: false,
      defaultOptions: { pattern: "^@[a-z0-9][a-z0-9_-]*$" },
      examples: ["@BadTag"],
      documentation: ruleDocs("tag-pattern")
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
      documentation: ruleDocs("allowed-tags")
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
      documentation: ruleDocs("no-restricted-tags")
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
};
