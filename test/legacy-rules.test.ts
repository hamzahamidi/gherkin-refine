import { describe, expect, it } from "vitest";
import { lintFiles, lintText } from "../src/index.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RuleSetting } from "../src/types.js";

async function lint(source: string, rules: Record<string, RuleSetting>, filePath = "features/sample.feature") {
  const result = await lintText(source, { filePath, config: { extends: [], rules } });
  return result.results[0]?.diagnostics ?? [];
}

async function lines(source: string, rule: string, setting: RuleSetting = "error", filePath?: string) {
  return (await lint(source, { [rule]: setting }, filePath)).map((item) => item.start.line);
}

async function fixed(source: string, rule: string, setting: RuleSetting = "error") {
  const result = await lintText(source, { filePath: "features/sample.feature", fix: true, config: { extends: [], rules: { [rule]: setting } } });
  return result.results[0]?.output;
}

describe("gherkin-lint compatible rules", () => {
  it("reports missing Feature and Scenario names, including Scenarios inside Rules", async () => {
    const source = "Feature:\n  Scenario:\n    Given x\n  Rule: R\n    Scenario:\n      Given y\n";
    expect(await lines(source, "no-unnamed-features")).toEqual([1]);
    expect(await lines("", "no-unnamed-features")).toEqual([1]);
    expect(await lines(source, "no-unnamed-scenarios")).toEqual([2, 5]);
  });

  it("reports outlines without Examples rows and Examples under a Scenario keyword", async () => {
    const source = `Feature: F
  Scenario Outline: none
    Given <x>
  Scenario Outline: empty
    Given <x>
    Examples:
      | x |
  Scenario Outline: rows
    Given <x>
    Examples:
      | x |
      | 1 |
  Scenario: plain with examples
    Given <x>
    Examples:
      | x |
      | 1 |
`;
    expect(await lines(source, "no-scenario-outlines-without-examples")).toEqual([2, 4]);
    expect(await lines(source, "no-examples-in-scenarios")).toEqual([13]);
    expect(await lines("# language: fr\nFonctionnalité: F\n  Plan du scénario: S\n    Soit <x>\n", "no-scenario-outlines-without-examples")).toEqual([3]);
  });

  it("reports empty files, files without Scenarios, and empty or single-use Backgrounds", async () => {
    expect(await lines("# comment\n", "no-empty-file")).toEqual([1]);
    expect(await lines("Feature: F\n", "no-empty-file")).toEqual([]);
    expect(await lines("Feature: F\n  Background:\n    Given x\n", "no-files-without-scenarios")).toEqual([1]);
    expect(await lines("Feature: F\n  Rule: R\n    Scenario: S\n      Given x\n", "no-files-without-scenarios")).toEqual([]);
    const backgrounds = "Feature: F\n  Background:\n  Scenario: one\n    Given x\n  Rule: R\n    Background:\n      Given y\n    Scenario: two\n      Given z\n";
    expect(await lines(backgrounds, "no-empty-background")).toEqual([2]);
    expect(await lines(backgrounds, "no-background-only-scenario")).toEqual([6]);
    expect(await lines("Feature: F\n  Background:\n    Given x\n  Scenario: one\n    Given y\n", "no-background-only-scenario")).toEqual([2]);
  });

  it("reports tag lines with comments and tags containing a hash", async () => {
    expect(await lines("@a @b # @c\n@d#e\nFeature: F\n  @x\n  Scenario: S\n    Given x\n", "no-partially-commented-tag-lines")).toEqual([1, 2]);
  });

  it("reports and fixes extra spaces between tags", async () => {
    const source = "@a   @b @c\nFeature: F\n";
    const diagnostics = await lint(source, { "one-space-between-tags": "error" });
    expect(diagnostics.map((item) => item.message)).toEqual(["There is more than one space between the tags @a and @b."]);
    expect(await fixed(source, "one-space-between-tags")).toBe("@a @b @c\nFeature: F\n");
  });

  it("reports tags repeated from an enclosing node", async () => {
    const source = `@a
Feature: F
  @a @b
  Rule: R
    @b @c
    Scenario Outline: S
      Given <x>
      @a @c
      Examples:
        | x |
        | 1 |
`;
    expect((await lint(source, { "no-superfluous-tags": "error" })).map((item) => [item.start.line, item.message])).toEqual([
      [3, "Tag duplication between Rule and its corresponding Feature: @a."],
      [5, "Tag duplication between Scenario Outline and its corresponding Rule: @b."],
      [8, "Tag duplication between Examples and its corresponding Feature: @a."],
      [8, "Tag duplication between Examples and its corresponding Rule: @a."],
      [8, "Tag duplication between Examples and its corresponding Scenario Outline: @c."]
    ]);
  });

  it("reports tags shared by every Scenario or every Examples block", async () => {
    const source = `Feature: F
  @t @u
  Scenario Outline: one
    Given <x>
    @e
    Examples:
      | x |
      | 1 |
    @e @f
    Examples:
      | x |
      | 2 |
  @t
  Scenario: two
    Given y
  Rule: R
    @r
    Scenario: three
      Given z
`;
    expect((await lint(source, { "no-homogenous-tags": "error" })).map((item) => [item.start.line, item.message])).toEqual([
      [1, "Tag @t is on every Scenario of this Feature; define it on the Feature instead."],
      [3, "Tag @e is on every Examples block of this Scenario Outline; define it on the Scenario Outline instead."]
    ]);
    expect(await lines("@f\nFeature: F\n  @only\n  Scenario: one\n    Given x\n", "no-homogenous-tags")).toEqual([]);
    const twoTags = "Feature: F\n  @a @b\n  Scenario: one\n    Given x\n  @b @a\n  Scenario: two\n    Given y\n";
    expect((await lint(twoTags, { "no-homogenous-tags": "error" })).map((item) => item.message)).toEqual([
      "Tag @a is on every Scenario of this Feature; define it on the Feature instead.",
      "Tag @b is on every Scenario of this Feature; define it on the Feature instead."
    ]);
  });

  it("reports and fixes repeated step keywords, treating * as And", async () => {
    const source = "Feature: F\n  Scenario: S\n    Given a\n    Given b\n    * c\n    When d\n    But e\n    But f\n";
    expect(await lines(source, "use-and")).toEqual([4, 8]);
    expect(await fixed(source, "use-and")).toBe("Feature: F\n  Scenario: S\n    Given a\n    And b\n    * c\n    When d\n    But e\n    And f\n");
    expect(await fixed("# language: fr\nFonctionnalité: F\n  Scénario: S\n    Soit a\n    Soit b\n", "use-and")).toBe("# language: fr\nFonctionnalité: F\n  Scénario: S\n    Soit a\n    Et que b\n");
  });

  it("checks and fixes indentation with gherkin-lint defaults and per-keyword levels", async () => {
    const source = "  @tag\nFeature: F\n   Background:\n      Given x\n  @s\n Scenario Outline: S\n  Given <x>\n      When y\n    Examples:\n     | x |\n      | 1 |\n  Rule: R\n      Scenario: nested is not checked\n";
    expect((await lint(source, { indentation: "error" })).map((item) => item.message)).toEqual([
      "Wrong indentation for \"feature tag\", expected indentation level of 0, but got 2.",
      "Wrong indentation for \"Background\", expected indentation level of 0, but got 3.",
      "Wrong indentation for \"Step\", expected indentation level of 2, but got 6.",
      "Wrong indentation for \"scenario tag\", expected indentation level of 0, but got 2.",
      "Wrong indentation for \"Scenario\", expected indentation level of 0, but got 1.",
      "Wrong indentation for \"Step\", expected indentation level of 2, but got 6.",
      "Wrong indentation for \"Examples\", expected indentation level of 0, but got 4.",
      "Wrong indentation for \"example\", expected indentation level of 2, but got 5.",
      "Wrong indentation for \"example\", expected indentation level of 2, but got 6.",
      "Wrong indentation for \"Rule\", expected indentation level of 0, but got 2."
    ]);
    expect(await fixed(source, "indentation")).toBe("@tag\nFeature: F\nBackground:\n  Given x\n@s\nScenario Outline: S\n  Given <x>\n  When y\nExamples:\n  | x |\n  | 1 |\nRule: R\n      Scenario: nested is not checked\n");
    const configured = "Feature: F\n  Scenario: S\n    Given x\n      When y\n";
    expect(await lines(configured, "indentation", ["error", { Scenario: 2, Step: 4, when: 6 }])).toEqual([]);
    expect(await lines(configured, "indentation", ["error", { Scenario: 2, Step: 4 }])).toEqual([4]);
  });

  it("requires or forbids a final line break and fixes either way", async () => {
    expect(await lines("Feature: F", "new-line-at-eof")).toEqual([1]);
    expect(await fixed("Feature: F", "new-line-at-eof")).toBe("Feature: F\n");
    expect(await lines("Feature: F\r\n", "new-line-at-eof", ["error", "no"])).toEqual([2]);
    expect(await fixed("Feature: F\n\n", "new-line-at-eof", ["error", "no"])).toBe("Feature: F");
  });

  it("checks file names with lodash case styles", async () => {
    expect(await lines("Feature: F\n", "file-name", "error", "features/checkoutFlow.feature")).toEqual([1]);
    expect(await lines("Feature: F\n", "file-name", "error", "features/CheckoutFlow.feature")).toEqual([]);
    expect((await lint("Feature: F\n", { "file-name": ["error", { style: "snake_case" }] }, "features/v2_checkout.feature"))[0]?.message)
      .toBe("File names should be written in snake_case e.g. \"v_2_checkout.feature\".");
    expect((await lint("Feature: F\n", { "file-name": ["error", { style: "kebab-case" }] }, "features/HTTP2Server.feature"))[0]?.message)
      .toBe("File names should be written in kebab-case e.g. \"http-2-server.feature\".");
    expect(await lines("Feature: F\n", "file-name", ["error", { style: "Title Case" }], "features/Crème Brûlée.feature")).toEqual([1]);
    expect(await lines("Feature: F\n", "file-name", ["error", { style: "camelCase" }], "features/emoji😀Name.feature")).toEqual([]);
  });

  it("ignores a Background without Scenarios, which no-files-without-scenarios covers", async () => {
    expect(await lines("Feature: F\n  Background:\n    Given x\n", "no-background-only-scenario")).toEqual([]);
  });

  it("requires tags matching each pattern on tagged Scenarios", async () => {
    const source = "Feature: F\n  @jira-1\n  Scenario: ok\n    Given x\n  @smoke\n  Scenario Outline: missing\n    Given <x>\n    Examples:\n      | x |\n      | 1 |\n  Scenario: untagged\n    Given y\n";
    expect((await lint(source, { "required-tags": ["error", { tags: ["^@jira-\\d+$"] }] })).map((item) => [item.start.line, item.message])).toEqual([
      [6, "No tag found matching ^@jira-\\d+$ for Scenario Outline."]
    ]);
    expect(await lines(source, "required-tags", ["error", { tags: ["^@jira-\\d+$"], ignoreUntagged: false }])).toEqual([6, 11]);
  });

  it("restricts patterns case-insensitively in names, descriptions, and steps", async () => {
    const source = "Feature: F\n  Draft notes\n  more text\n\n  Background:\n    Given a TODO step\n\n  Scenario: todo later\n    Given x\n";
    const diagnostics = await lint(source, { "no-restricted-patterns": ["error", { Global: ["todo"], Feature: ["^draft"] }] });
    expect(diagnostics.map((item) => [item.start.line, item.message])).toEqual([
      [1, "Feature description: \"Draft notes\" matches restricted pattern \"/^draft/i\"."],
      [6, "Step text: \"a TODO step\" matches restricted pattern \"/todo/i\"."],
      [8, "Scenario name: \"todo later\" matches restricted pattern \"/todo/i\"."]
    ]);
  });

  it("counts Scenarios per file, expanding outline rows unless disabled", async () => {
    const source = "Feature: F\n  Scenario: a\n    Given x\n  Scenario Outline: b\n    Given <x>\n    Examples:\n      | x |\n      | 1 |\n      | 2 |\n";
    expect((await lint(source, { "max-scenarios-per-file": ["error", { maxScenarios: 2 }] }))[0]?.message).toBe("Number of scenarios exceeds maximum: 3/2.");
    expect(await lines(source, "max-scenarios-per-file", ["error", { maxScenarios: 2, countOutlineExamples: false }])).toEqual([]);
  });

  it("allows one explicit When and does not count And after When", async () => {
    const source = "Feature: F\n  Scenario: S\n    Given x\n    When a\n    And b\n    Then c\n  Scenario: T\n    When a\n    Then b\n    When c\n";
    expect((await lint(source, { "only-one-when": "error" })).map((item) => [item.start.line, item.message])).toEqual([
      [10, "Scenario \"T\" contains 2 When statements (max 1)."]
    ]);
  });

  it("checks content inside Rules when rule content sets its offset", async () => {
    const source = "Feature: F\n  Rule: R\n    Scenario: S\n      Given x\n     When y\n";
    const levels = { Rule: 2, Scenario: 2, Step: 4 };
    expect(await lines(source, "indentation", ["error", levels])).toEqual([]);
    expect(await lines(source, "indentation", ["error", { ...levels, "rule content": 2 }])).toEqual([5]);
  });

  it("produces stable output when every fixable rule runs twice", async () => {
    const rules = {
      indentation: ["error", { Scenario: 2, Step: 4, Examples: 4, example: 6 }],
      "new-line-at-eof": ["error", "yes"],
      "use-and": "error",
      "one-space-between-tags": "error",
      "no-trailing-whitespace": "error",
      "no-extra-blank-lines": "error"
    } as const;
    const source = "@a   @b\nFeature: F  \n\n\n Scenario Outline: S\n  Given <x>\n  Given y\n      \"\"\"\n      keep  \n\n\n      \"\"\"\n   Examples:\n   | x |\n   | 1 |";
    const once = (await lintText(source, { filePath: "features/sample.feature", fix: true, config: { extends: [], rules } })).results[0]?.output ?? "";
    const twice = (await lintText(once, { filePath: "features/sample.feature", fix: true, config: { extends: [], rules } })).results[0];
    expect(twice?.output ?? once).toBe(once);
    expect(twice?.diagnostics).toEqual([]);
    expect(once).toContain("      keep  \n\n\n");
  });

  it.each(["", "# comment only\n"])("reports only missing content on a featureless document: %j", async source => {
    const rules = Object.fromEntries([
      "no-unnamed-features", "no-unnamed-scenarios", "no-scenario-outlines-without-examples", "no-examples-in-scenarios", "no-empty-file",
      "no-files-without-scenarios", "no-empty-background", "no-background-only-scenario", "no-partially-commented-tag-lines",
      "one-space-between-tags", "no-superfluous-tags", "no-homogenous-tags", "use-and", "indentation",
      "required-tags", "no-restricted-patterns", "max-scenarios-per-file", "only-one-when"
    ].map((id) => [id, "error" as const]));
    expect((await lint(source, rules)).map((item) => item.ruleId)).toEqual(["no-empty-file", "no-unnamed-features"]);
  });

  it("walks Backgrounds and Scenarios inside Rules and tolerates Examples without a table", async () => {
    const source = `Feature: F
  Background:
    Given a
    Given b
  Rule: R
    Background:
      Given c
      Given d
    Scenario Outline: S
      Given <x>
      Examples:
`;
    expect(await lines(source, "use-and")).toEqual([4, 8]);
    expect(await lines(source, "no-superfluous-tags")).toEqual([]);
    expect(await lines(source, "no-homogenous-tags")).toEqual([]);
    expect(await lines("Feature: F\nScenario Outline: S\n  Given <x>\nExamples:\n", "indentation")).toEqual([]);
    expect(await lines("Feature: F\n", "file-name", ["error", {}], "features/Checkout.feature")).toEqual([]);
    expect(await lines("Feature: F\n", "file-name", "error", "features/checkout.feature")).toEqual([1]);
  });

  it.each([
    ["indentation", { Step: -1 }], ["indentation", { Unknown: 2 }], ["indentation", "two"],
    ["new-line-at-eof", "maybe"], ["file-name", { style: "SCREAMING" }], ["file-name", { case: "camelCase" }],
    ["indentation", { "rule content": "2" }], ["required-tags", { tags: ["("] }], ["required-tags", { ignoreUntagged: "yes" }],
    ["no-restricted-patterns", { Step: ["x"] }], ["no-restricted-patterns", { Global: ["("] }], ["max-scenarios-per-file", { maxScenarios: -1 }],
    ["max-scenarios-per-file", { countOutlineExamples: 1 }], ["name-length", { max: 10, Step: 5 }], ["name-length", { Background: 5 }],
    ["no-duplicate-scenario-names", { scope: "everywhere" }]
  ])("rejects invalid options for %s: %j", async (rule, options) => {
    await expect(lintText("Feature: F\n", { config: { extends: [], rules: { [rule]: ["error", options] } } })).rejects.toThrow("Invalid options for rule");
  });

  it("walks Feature Backgrounds and Rule children in the tag and pattern rules", async () => {
    const source = `Feature: F
  Background:
    Given shared

  Rule: Draft rule
    Background:
      Given a draft step

    @r
    Scenario: one
      Given x

    @r
    Scenario: two
      Given y
`;
    expect(await lines(source, "no-superfluous-tags")).toEqual([]);
    expect((await lint(source, { "no-homogenous-tags": "error" })).map((item) => [item.start.line, item.message])).toEqual([
      [5, "Tag @r is on every Scenario of this Rule; define it on the Rule instead."]
    ]);
    expect((await lint(source, { "no-restricted-patterns": ["error", { Rule: ["draft"], Background: ["draft"] }] })).map((item) => [item.start.line, item.message])).toEqual([
      [5, "Rule name: \"Draft rule\" matches restricted pattern \"/draft/i\"."],
      [7, "Step text: \"a draft step\" matches restricted pattern \"/draft/i\"."]
    ]);
  });

  it("checks Feature, Rule, Scenario, and Step lengths separately and keeps the max shorthand", async () => {
    const source = "Feature: Twelve chars\n  Rule: Rule name\n    Scenario: Scenario name\n      Given a long step text\n";
    expect((await lint(source, { "name-length": ["error", { Feature: 5, Rule: 50, Scenario: 5, Step: 10 }] })).map((item) => item.message)).toEqual([
      "Feature name has 12 characters; configured maximum is 5.",
      "Scenario name has 13 characters; configured maximum is 5.",
      "Step text has 16 characters; configured maximum is 10."
    ]);
    expect(await lines(source, "name-length", ["error", { max: 12 }])).toEqual([3]);
  });

  it("finds duplicate Scenario names across files with the anywhere scope", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "gherkin-refine-dupes-"));
    try {
      await writeFile(join(cwd, "a.feature"), "Feature: A\n  Scenario: Pay\n    Given x\n");
      await writeFile(join(cwd, "b.feature"), "Feature: B\n  Rule: R\n    Scenario: pay\n      Given y\n");
      const anywhere = await lintFiles(["."], { cwd, config: { extends: [], rules: { "no-duplicate-scenario-names": ["error", { scope: "anywhere" }] } } });
      expect(anywhere.results.flatMap((item) => item.diagnostics.map((diagnostic) => [item.filePath, diagnostic.message]))).toEqual([["b.feature", "Scenario name duplicates a.feature:2."]]);
      const feature = await lintFiles(["."], { cwd, config: { extends: [], rules: { "no-duplicate-scenario-names": "error" } } });
      expect(feature.summary.errors).toBe(0);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
