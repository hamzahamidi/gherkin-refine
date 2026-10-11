import { describe, expect, it } from "vitest";
import { defineRule, forEachScenario, lintText, type PluginModule } from "../src/index.js";

interface MaxTagsOptions {
  readonly max: number;
}

const maxScenarioTags = defineRule<MaxTagsOptions>({
  meta: {
    description: "Limit the number of tags on a Scenario.",
    category: "tags",
    recommended: false,
    defaultOptions: { max: 3 }
  },
  validateOptions: (options): options is MaxTagsOptions =>
    typeof options === "object" && options !== null && "max" in options
    && typeof options.max === "number" && Number.isInteger(options.max) && options.max > 0,
  run({ document, options, report }) {
    forEachScenario(document, (scenario) => {
      if (scenario.tags.length <= options.max) return;
      report({
        message: `Scenario has ${scenario.tags.length} tags; the limit is ${options.max}.`,
        start: { line: scenario.location.line, column: scenario.location.column ?? 1 }
      });
    });
  }
});

const typedPlugin = { rules: { "max-scenario-tags": maxScenarioTags } } satisfies PluginModule;


describe("public API", () => {
  it("accepts valid custom rules and rejects invalid contracts", () => {
    const rule = {
      meta: { description: "Checks an example", category: "correctness" as const, recommended: false },
      run: () => undefined
    };

    expect(defineRule(rule)).toBe(rule);
    expect(() => defineRule(undefined as never)).toThrow("A rule must provide metadata and a run function.");
    expect(() => defineRule({ ...rule, meta: { ...rule.meta, description: 42 } } as never)).toThrow("A rule must provide a description and category.");
  });

  it("types rule options from validateOptions without casts in run", () => {
    expect(typedPlugin.rules["max-scenario-tags"]).toBe(maxScenarioTags);
    expect(maxScenarioTags.validateOptions?.({ max: 2 })).toBe(true);
    expect(maxScenarioTags.validateOptions?.({ max: 0 })).toBe(false);
    expect(maxScenarioTags.validateOptions?.(maxScenarioTags.meta.defaultOptions)).toBe(true);
  });

  it("lints through the package entry point", async () => {
    const result = await lintText("Feature: Public API\n  Scenario: valid\n    Given a condition\n", {
      filePath: "features/public-api.feature"
    });

    expect(result.tool.name).toBe("gherkin-refine");
    expect(result.summary.files).toBe(1);
    expect(result.summary.errors).toBe(0);
  });
});
