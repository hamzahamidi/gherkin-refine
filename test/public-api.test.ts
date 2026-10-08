import { describe, expect, it } from "vitest";
import { defineRule, lintText } from "../src/index.js";

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

  it("lints through the package entry point", async () => {
    const result = await lintText("Feature: Public API\n  Scenario: valid\n    Given a condition\n", {
      filePath: "features/public-api.feature"
    });

    expect(result.tool.name).toBe("gherkin-refine");
    expect(result.summary.files).toBe(1);
    expect(result.summary.errors).toBe(0);
  });
});
