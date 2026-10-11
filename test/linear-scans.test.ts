import { describe, expect, it } from "vitest";
import { lintText } from "../src/index.js";
import type { LintConfig } from "../src/types.js";

const LONG = 200_000;

async function lint(source: string, config: LintConfig) {
  return lintText(source, { filePath: "long.feature", config: { extends: [], ...config } });
}

describe("long whitespace runs lint in linear time", () => {
  it("reports trailing whitespace on a line with a long inner run of spaces", async () => {
    const source = `Feature: x\n  Scenario: y\n    Given a${" ".repeat(LONG)}b \n`;
    const result = await lint(source, { rules: { "no-trailing-whitespace": "error" } });
    expect(result.results[0]?.diagnostics.map((item) => item.start)).toEqual([{ line: 3, column: LONG + 13 }]);
  });

  it("removes only the final run of line breaks", async () => {
    const source = `Feature: x\n${"\n".repeat(LONG)}# end\r\n\n`;
    const result = await lint(source, { rules: { "new-line-at-eof": ["error", "no"] } });
    expect(result.results[0]?.diagnostics[0]?.fix?.range).toEqual([source.length - 3, source.length]);
  });

  it("parses a disable directive with a long run of spaces before its rule list", async () => {
    const source = `Feature: x\n  # gherkin-refine-disable-file${" ".repeat(LONG)}no-trailing-whitespace\n  Scenario: y \n`;
    const result = await lint(source, { rules: { "no-trailing-whitespace": "error" } });
    expect(result.summary.errors).toBe(0);
  });

  it("looks for a language header in a long comment-only document", async () => {
    const result = await lint(`${"\n".repeat(LONG)}# not a header\n`, { rules: { "no-empty-file": "error" } });
    expect(result.summary.files).toBe(1);
  });
});

describe("disable directive reasons", () => {
  it("keeps a second separator in the reason, as the first separator consumes the shared space", async () => {
    const source = "Feature: x\n  # gherkin-refine-disable-line no-trailing-whitespace -- -- legacy\n";
    const result = await lintText(source, {
      filePath: "reason.feature",
      reportUnusedDisableDirectives: true,
      config: { extends: [], rules: { "no-trailing-whitespace": "error" } }
    });
    expect(result.results[0]?.diagnostics[0]?.data).toEqual({ reason: "-- legacy" });
  });
});
