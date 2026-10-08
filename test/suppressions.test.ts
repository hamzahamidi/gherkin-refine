import { describe, expect, it } from "vitest";
import { parseGherkin } from "../src/parser/document.js";
import { applySuppressions } from "../src/core/suppressions.js";
import { lintText } from "../src/index.js";
import type { Diagnostic } from "../src/types.js";

function check(source: string, diagnostics: readonly Diagnostic[], unused = true) {
  const parsed = parseGherkin(source, "one.feature");
  if (!parsed.document) throw new Error("Expected valid Gherkin.");
  return applySuppressions(parsed.document, diagnostics, unused);
}

function diagnostic(line: number, ruleId = "name-length"): Diagnostic {
  return { filePath: "one.feature", ruleId, severity: "error", message: "Fixture finding", start: { line, column: 1 } };
}

describe("suppression state", () => {
  it("suppresses only matching diagnostics on the directive line", () => {
    const source = "Feature: F\n  # gherkin-refine-disable-line name-length -- synthetic same-line finding\n  # ordinary comment\n";
    expect(check(source, [diagnostic(2), diagnostic(2, "scenario-size"), diagnostic(3)])).toEqual([
      diagnostic(2, "scenario-size"), diagnostic(3)
    ]);
  });

  it("enables all rules after both blanket and named disables", () => {
    const source = "# gherkin-refine-disable\n# gherkin-refine-disable name-length\nFeature: F\n# gherkin-refine-enable\n  Scenario: S\n";
    expect(check(source, [diagnostic(3), diagnostic(5)])).toEqual([diagnostic(5)]);
  });

  it("handles blanket one-shot directives and ignores later directives", () => {
    const source = "Feature: F\n# gherkin-refine-disable-next-line\n  Scenario: S\n# gherkin-refine-disable-file\n";
    const result = check(source, [diagnostic(1), diagnostic(3), diagnostic(3, "scenario-size")]);
    expect(result.map(d => [d.ruleId, d.start.line])).toEqual([["name-length", 1], ["unused-disable-directive", 4]]);
    expect(result[1]?.data).toBeUndefined();
    expect(check(source, [diagnostic(3)], false)).toEqual([]);
  });

  it("uses configured unused severity and respects explicit reporting overrides", async () => {
    const source = "# gherkin-refine-disable missing-rule\nFeature: F\n";
    const config = { extends: [] as const, rules: { "unused-disable-directive": "error" as const } };
    expect((await lintText(source, { config })).summary.errors).toBe(1);
    expect((await lintText(source, { config, reportUnusedDisableDirectives: false })).summary.errors).toBe(0);
    expect((await lintText(source, { config: { extends: [], reportUnusedDisableDirectives: true } })).summary.warnings).toBe(1);
    expect((await lintText(source, { config: { extends: [], reportUnusedDisableDirectives: true, rules: { "unused-disable-directive": "off" } } })).summary.warnings).toBe(0);
  });
});
