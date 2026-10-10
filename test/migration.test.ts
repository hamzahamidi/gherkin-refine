import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigError } from "../src/config/index.js";
import { migrateLegacyConfig, migrateLegacyFile } from "../src/compat/migrate.js";
import { lintText } from "../src/index.js";

const temporaryDirectories: string[] = [];

async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "gherkin-refine-migration-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("migrateLegacyConfig", () => {
  it.each([true, "error", 2])("maps error severity %j", severity => {
    expect(migrateLegacyConfig({ "no-duplicate-tags": severity }).config.rules?.["no-duplicate-tags"]).toBe("error");
  });

  it.each([false, "off", 0, "warn", "warning", 1])("maps disabled or warning severity %j", severity => {
    expect(migrateLegacyConfig({ "no-duplicate-tags": severity }).config.rules?.["no-duplicate-tags"])
      .toBe(severity === "warn" || severity === "warning" || severity === 1 ? "warn" : "off");
  });

  it("maps lowercase limits and keeps the higher of unequal name limits", () => {
    const result = migrateLegacyConfig({
      "scenario-size": ["on", { scenario: 6 }],
      "name-length": ["on", { feature: 30, scenario: 30 }]
    });
    expect(result.config.rules).toEqual({ "scenario-size": ["error", { maxSteps: 6 }], "name-length": ["error", { max: 30 }] });
    expect(result.unsupported).toEqual(["name-length: Step text limits do not have a modern equivalent."]);
    const unequal = migrateLegacyConfig({ "name-length": ["on", { Feature: 50, Scenario: 85, Step: 115 }] });
    expect(unequal.config.rules?.["name-length"]).toEqual(["error", { max: 85 }]);
    expect(unequal.mapped).toEqual(["name-length -> name-length (partial)"]);
    expect(unequal.unsupported).toEqual([
      "name-length: one limit covers Feature and Scenario names, so the Feature limit rises from 50 to 85. Step text limits do not have a modern equivalent."
    ]);
    const scenarioOnly = migrateLegacyConfig({ "name-length": ["on", { Scenario: 40 }] });
    expect(scenarioOnly.config.rules?.["name-length"]).toEqual(["error", { max: 70 }]);
  });

  it("maps direct rules and reports partial or unsupported legacy behavior", () => {
    const result = migrateLegacyConfig({
      "no-duplicate-tags": ["warn", { includeFeature: true }],
      "no-dupe-feature-names": "on",
      "no-dupe-scenario-names": ["on", "in-feature"],
      "no-unused-variables": true,
      "no-trailing-spaces": false,
      "scenario-size": ["on", { "steps-length": { Scenario: 8, Background: 3 } }],
      "name-length": [2, { Feature: 40, Scenario: 40, Step: 25 }],
      "unknown-rule": "on",
      "invalid-severity": "sometimes"
    });

    expect(result.config.rules).toEqual({
      "no-duplicate-tags": ["warn", { includeFeature: true }],
      "no-duplicate-feature-names": "error",
      "no-duplicate-scenario-names": "error",
      "no-unused-outline-variables": "error",
      "no-trailing-whitespace": "off",
      "scenario-size": ["error", { maxSteps: 8 }],
      "background-size": ["error", { maxSteps: 3 }],
      "name-length": ["error", { max: 40 }]
    });
    expect(result.mapped).toContain("no-dupe-scenario-names -> no-duplicate-scenario-names (scope now includes the enclosing Rule)");
    expect(result.mapped).toContain("scenario-size -> background-size");
    expect(result.unsupported).toContain("name-length: Step text limits do not have a modern equivalent.");
    expect(result.unsupported).toContain("unknown-rule: no equivalent rule");
    expect(result.unsupported).toContain("invalid-severity: unsupported setting");
    expect(result.content).toBe(`${JSON.stringify(result.config, null, 2)}\n`);
  });

  it("uses gherkin-lint defaults when size settings have no options", () => {
    const result = migrateLegacyConfig({
      "scenario-size": "on",
      "name-length": "on",
      "no-dupe-scenario-names": "on"
    });

    expect(result.config.rules).toEqual({
      "scenario-size": ["error", { maxSteps: 15 }],
      "background-size": ["error", { maxSteps: 15 }],
      "name-length": ["error", { max: 70 }],
      "no-duplicate-scenario-names": "error"
    });
    expect(result.unsupported).toEqual([
      "name-length: Step text limits do not have a modern equivalent.",
      "no-dupe-scenario-names: modern scope is within each Feature or Rule, not across all files."
    ]);
  });

  it("maps only the step limits that are present", () => {
    const backgroundOnly = migrateLegacyConfig({ "scenario-size": ["on", { "steps-length": { Background: 4 } }] });
    expect(backgroundOnly.config.rules).toEqual({ "background-size": ["error", { maxSteps: 4 }] });
    const ruleOnly = migrateLegacyConfig({ "scenario-size": ["on", { "steps-length": { Rule: 4 } }] });
    expect(ruleOnly.config.rules).toEqual({});
    expect(ruleOnly.unsupported).toEqual(["scenario-size: no Scenario or Background limit was present."]);
    const disabledRuleOnly = migrateLegacyConfig({ "scenario-size": ["off", { "steps-length": { Rule: 4 } }] });
    expect(disabledRuleOnly.config.rules).toEqual({});
    expect(disabledRuleOnly.unsupported).toEqual([]);
  });

  it("writes disabled rules without options and does not report disabled rules as unsupported", () => {
    const result = migrateLegacyConfig({
      "name-length": "off",
      "scenario-size": ["off", { "steps-length": { Scenario: 4, Background: 2 } }],
      "indentation": "off",
      "allowed-tags": ["off", { tags: ["@smoke"] }]
    });
    expect(result.config.rules).toEqual({ "name-length": "off", "scenario-size": "off", "background-size": "off", "allowed-tags": "off" });
    expect(result.unsupported).toEqual([]);
  });

  it("disables presets so only the legacy rules run", async () => {
    const result = migrateLegacyConfig({ "no-trailing-spaces": "on" });
    expect(result.config.extends).toEqual([]);
    expect(result.notes).toEqual(["extends: [] keeps gherkin-lint behavior, where only listed rules run. Remove it to add the recommended rules."]);
    const source = "Feature: Checkout\n\n  Scenario: pay\n    Given a cart\n\n  Scenario: pay\n    Given a cart\n";
    const linted = await lintText(source, { filePath: "checkout.feature", config: result.config });
    expect(linted.results[0]?.diagnostics).toEqual([]);
  });

  it("maps allowed and restricted tags to the native rules", async () => {
    const result = migrateLegacyConfig({
      "allowed-tags": ["on", { tags: ["@smoke"], patterns: ["^@jira-\\d+$"] }],
      "no-restricted-tags": ["warn", { tags: ["@wip"] }]
    });
    expect(result.config.rules).toEqual({
      "allowed-tags": ["error", { tags: ["@smoke"], patterns: ["^@jira-\\d+$"] }],
      "no-restricted-tags": ["warn", { tags: ["@wip"] }]
    });
    expect(result.mapped).toEqual([
      "allowed-tags -> allowed-tags (scope now includes tags inside Rule blocks)",
      "no-restricted-tags -> no-restricted-tags (scope now includes tags inside Rule blocks)"
    ]);

    const source = "@smoke\nFeature: Checkout\n\n  Rule: Payment\n\n    @wip @jira-12\n    Scenario: pay\n      Given a cart\n";
    const linted = await lintText(source, { filePath: "checkout.feature", config: result.config });
    expect(linted.results[0]?.diagnostics.map((diagnostic) => [diagnostic.ruleId, diagnostic.severity, diagnostic.message])).toEqual([
      ["allowed-tags", "error", "Tag @wip is not allowed."],
      ["no-restricted-tags", "warn", "Tag @wip is restricted."]
    ]);
  });
});

describe("migrateLegacyFile", () => {
  it("parses comments without changing comment like text and leaves dry run output unwritten", async () => {
    const directory = await tempDirectory();
    const inputPath = join(directory, ".gherkin-lintrc");
    const outputPath = join(directory, "gherkin-refine.config.json");
    await writeFile(inputPath, `{
      // legacy config comment
      "no-duplicate-tags": ["on", {"pattern": "https://example.com/a//b/*c*/"}],
      /* block comment */
      "no-unused-variables": "off"
    }`);

    const result = await migrateLegacyFile(inputPath, { outputPath, dryRun: true });

    expect(result.config.rules?.["no-duplicate-tags"]).toEqual(["error", { pattern: "https://example.com/a//b/*c*/" }]);
    expect(result.config.rules?.["no-unused-outline-variables"]).toBe("off");
    expect(result.content).toContain('"pattern": "https://example.com/a//b/*c*/"');
    await expect(readFile(outputPath, "utf8")).rejects.toThrow();
  });

  it("writes a new file, protects existing output, and replaces it only with force", async () => {
    const directory = await tempDirectory();
    const inputPath = join(directory, ".gherkin-lintrc");
    const outputPath = join(directory, "gherkin-refine.config.json");
    await writeFile(inputPath, JSON.stringify({ "no-duplicate-tags": "on" }));

    const result = await migrateLegacyFile(inputPath, { outputPath });
    expect(await readFile(outputPath, "utf8")).toBe(result.content);

    await expect(migrateLegacyFile(inputPath, { outputPath })).rejects.toBeInstanceOf(ConfigError);
    await writeFile(outputPath, "existing content");
    await expect(migrateLegacyFile(inputPath, { outputPath })).rejects.toThrow("Use --force to replace it.");
    expect(await readFile(outputPath, "utf8")).toBe("existing content");

    const forced = await migrateLegacyFile(inputPath, { outputPath, force: true });
    expect(await readFile(outputPath, "utf8")).toBe(forced.content);
  });

  it("rejects malformed JSON and non object legacy files", async () => {
    const directory = await tempDirectory();
    const inputPath = join(directory, ".gherkin-lintrc");
    await writeFile(inputPath, "{invalid json}");
    await expect(migrateLegacyFile(inputPath, { dryRun: true })).rejects.toBeInstanceOf(ConfigError);

    await writeFile(inputPath, "[]");
    await expect(migrateLegacyFile(inputPath, { dryRun: true })).rejects.toThrow("Legacy configuration must be a JSON object.");
  });
});
