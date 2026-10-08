import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lintFiles, lintText } from "../src/index.js";
import { forEachStep, parseGherkin } from "../src/parser/document.js";

const temporaryDirectories: string[] = [];

async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "gherkin-refine-rules-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function docStringContents(source: string): string[] {
  const parsed = parseGherkin(source, "features/data.feature");
  if (!parsed.document) throw new Error("Expected valid Gherkin.");
  const contents: string[] = [];
  forEachStep(parsed.document, (step) => {
    if (step.docString) contents.push(step.docString.content);
  });
  return contents;
}

describe("opt in rule behavior", () => {
  it.each(["", "# comment only\n"])("runs every file rule on a featureless document: %j", async source => {
    const result = await lintText(source, { config: { extends: [], rules: {
      "no-duplicate-tags": "error", "no-unused-outline-variables": "error", "no-undefined-outline-variables": "error",
      "scenario-size": "error", "background-size": "error", "feature-size": "error", "name-length": "error",
      "tag-pattern": "error", "logical-keyword-order": "error", "no-trailing-whitespace": "error", "no-extra-blank-lines": "error"
    } } });
    expect(result.results[0]?.diagnostics).toEqual([]);
  });

  it.each([
    ["name-length", false], ["name-length", { max: 0 }], ["name-length", { max: 1.5 }],
    ["scenario-size", []], ["scenario-size", { maxSteps: -1 }],
    ["feature-size", { maxScenarios: 0 }], ["feature-size", { maxScenarios: "2" }],
    ["tag-pattern", {}], ["tag-pattern", { pattern: 2 }], ["tag-pattern", { pattern: "[" }]
  ])("rejects invalid options for %s: %j", async (rule, options) => {
    await expect(lintText("Feature: F\n", { config: { extends: [], rules: { [rule as string]: ["error", options] } } })).rejects.toThrow("Invalid options for rule");
  });

  it("uses outline placeholders in Doc Strings and data tables", async () => {
    const source = `Feature: Arguments
  Scenario Outline: Doc String
    Given a document
      """
      <body> <missing>
      """
    Examples:
      | body | unused |
      | one  | two    |
  Scenario Outline: Table
    Given a table
      | value   |
      | <value> |
    Examples:
      | value |
      | one   |
`;
    const result = await lintText(source);
    expect(result.results[0]?.diagnostics.map(d => [d.ruleId, d.message])).toEqual([
      ["no-undefined-outline-variables", "Placeholder <missing> has no matching Examples column."],
      ["no-unused-outline-variables", "Scenario Outline variable <unused> is not used."]
    ]);
  });

  it("checks placeholders against every Examples table, including empty tables", async () => {
    const result = await lintText(`Feature: Examples
  Scenario Outline: Different headers
    Given <value> and <other>
    Examples: first
      | value | other |
      | one   | two   |
    Examples: second
      | value |
      | three |
  Scenario Outline: Empty
    Given <absent>
    Examples:
`);
    expect(result.results[0]?.diagnostics.map(d => d.message)).toEqual([
      "Placeholder <other> has no matching Examples column.", "Placeholder <absent> has no matching Examples column."
    ]);
  });

  it("allows conjunction and wildcard keywords between semantic stages", async () => {
    const result = await lintText("Feature: F\n  Scenario: S\n    Given one\n    And two\n    * three\n    When four\n    But five\n    Then six\n", {
      config: { extends: [], rules: { "logical-keyword-order": "error" } }
    });
    expect(result.summary.errors).toBe(0);
  });

  it("removes a terminal extra blank line", async () => {
    const result = await lintText("Feature: F\n\n  ", { fix: true, config: { extends: [], rules: { "no-extra-blank-lines": "error" } } });
    expect(result.results[0]?.output).toBe("Feature: F\n\n");
    expect(result.results[0]?.fixes).toEqual([{ range: [12, 14], text: "" }]);
  });

  it("limits Feature and Scenario names", async () => {
    const result = await lintText(`Feature: Checkout flow
  Scenario: place an order
    Given a cart exists
`, {
      config: { extends: [], rules: { "name-length": ["error", { max: 8 }] } }
    });

    expect(result.results[0]?.diagnostics.map((item) => item.message)).toEqual([
      "Feature name has 13 characters; configured maximum is 8.",
      "Scenario name has 14 characters; configured maximum is 8."
    ]);
  });

  it("checks tag patterns on Feature, Rule, Scenario, and Examples tags", async () => {
    const result = await lintText(`@Bad
Feature: Tags
  @good
  Rule: Valid scope
    @bad_
    Scenario Outline: Check
      Given a value <item>

      @X
      Examples:
        | item |
        | one  |
`, {
      config: { extends: [], rules: { "tag-pattern": ["error", { pattern: "^@[a-z]+$" }] } }
    });

    expect(result.results[0]?.diagnostics.map((item) => item.message)).toEqual([
      "Tag @Bad does not match /^@[a-z]+$/.",
      "Tag @bad_ does not match /^@[a-z]+$/.",
      "Tag @X does not match /^@[a-z]+$/."
    ]);
    expect(result.results[0]?.diagnostics.map((item) => item.start.line)).toEqual([1, 5, 9]);
  });

  it("reports semantic keyword stages that move backward", async () => {
    const result = await lintText(`Feature: Order
  Scenario: reverse stages
    Given a cart exists
    When checkout starts
    Then an order is placed
    When checkout starts again
    Given a second cart exists
`, {
      config: { extends: [], rules: { "logical-keyword-order": "error" } }
    });

    expect(result.results[0]?.diagnostics.map((item) => item.start.line)).toEqual([6, 7]);
    expect(result.results[0]?.diagnostics.map((item) => item.message)).toEqual([
      "Step keyword stage moves backward from Then to When.",
      "Step keyword stage moves backward from Then to Given."
    ]);
  });

  it("reports and removes spaces and tabs at line ends", async () => {
    const result = await lintText("Feature: Titled  \n  Scenario: One\n    Given a value\t\n", {
      config: { extends: [], rules: { "no-trailing-whitespace": "error" } },
      fix: true
    });

    expect(result.results[0]?.diagnostics).toHaveLength(0);
    expect(result.results[0]?.output).toBe("Feature: Titled\n  Scenario: One\n    Given a value\n");
  });

  it("removes repeated blank lines while preserving CRLF and the final newline", async () => {
    const result = await lintText("Feature: F\r\n\r\n\r\n  Scenario: One\r\n", {
      config: { extends: [], rules: { "no-extra-blank-lines": "error" } },
      fix: true
    });

    expect(result.results[0]?.diagnostics).toHaveLength(0);
    expect(result.results[0]?.output).toBe("Feature: F\r\n\r\n  Scenario: One\r\n");
  });

  it.each(["\n", "\r\n"])("preserves Doc String payloads with %s line endings", async (newline) => {
    const lines = [
      "Feature: Preserve data  ",
      "  Background: shared data",
      "    Given a document",
      "      \"\"\"",
      "      keep spaces  ",
      "      ",
      "      ",
      "      \"\"\"",
      "",
      "",
      "  Rule: Nested data",
      "    Background: rule data",
      "      Given another document",
      "        ```",
      "        keep tabs\t ",
      "        ",
      "        ",
      "        ```",
      "    Scenario: Continue",
      "      Given a value",
      ""
    ];
    const source = lines.join(newline);
    const originalContents = docStringContents(source);
    const result = await lintText(source, {
      config: {
        extends: [],
        rules: { "no-trailing-whitespace": "error", "no-extra-blank-lines": "error" }
      },
      fix: true
    });
    const output = result.results[0]?.output;

    expect(output).toBe([
      "Feature: Preserve data",
      "  Background: shared data",
      "    Given a document",
      "      \"\"\"",
      "      keep spaces  ",
      "      ",
      "      ",
      "      \"\"\"",
      "",
      "  Rule: Nested data",
      "    Background: rule data",
      "      Given another document",
      "        ```",
      "        keep tabs\t ",
      "        ",
      "        ",
      "        ```",
      "    Scenario: Continue",
      "      Given a value",
      ""
    ].join(newline));
    expect(docStringContents(output ?? "")).toEqual(originalContents);
  });

  it.each(['"""', "```"])("resumes whitespace checks after a %s closing delimiter", async (delimiter) => {
    const source = [
      "Feature: F",
      "  Scenario: S",
      "    Given a document",
      `      ${delimiter}`,
      "      payload",
      `      ${delimiter}suffix`,
      "    When another step  ",
      "",
      "",
      "    Then the result is visible",
      ""
    ].join("\n");

    const result = await lintText(source, {
      config: { extends: [], rules: { "no-trailing-whitespace": "error", "no-extra-blank-lines": "error" } },
      fix: true
    });

    expect(result.results[0]?.output).toBe([
      "Feature: F",
      "  Scenario: S",
      "    Given a document",
      `      ${delimiter}`,
      "      payload",
      `      ${delimiter}suffix`,
      "    When another step",
      "",
      "    Then the result is visible",
      ""
    ].join("\n"));
  });
});

describe("project rule behavior", () => {
  it("finds duplicate Feature names across files without flagging unique names", async () => {
    const cwd = await tempDirectory();
    const features = join(cwd, "features");
    await mkdir(features);
    await writeFile(join(features, "a-first.feature"), "Feature: Checkout\n  Scenario: First\n");
    await writeFile(join(features, "b-duplicate.feature"), "Feature: checkout\n  Scenario: Second\n");
    await writeFile(join(features, "c-unique.feature"), "Feature: Search\n  Scenario: Third\n");

    const result = await lintFiles(["features/*.feature"], { cwd });
    const duplicate = result.results.find((file) => file.filePath === "features/b-duplicate.feature")?.diagnostics[0];

    expect(result.summary.errors).toBe(1);
    expect(duplicate?.ruleId).toBe("no-duplicate-feature-names");
    expect(duplicate?.data).toEqual({ duplicateOf: "features/a-first.feature" });
  });
});
