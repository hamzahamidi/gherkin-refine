import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import { formatResult, lintFiles, lintText } from "../src/index.js";
import { LintExecutionError } from "../src/core/engine.js";
import { ConfigError, loadConfig } from "../src/config/index.js";
import { migrateLegacyConfig } from "../src/compat/migrate.js";

const temporaryDirectories: string[] = [];

async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "gherkinlint-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("lintText", () => {
  it("parses Rule backgrounds and nested Scenario Outlines", async () => {
    const source = `Feature: Checkout
  Background:
    Given a cart exists

  Rule: Promotions
    Background:
      Given a promotion is active

    Scenario Outline: apply a promotion
      When the code <code> is used
      Then the total is reduced

      Examples:
        | code | unused |
        | SAVE | value  |
`;
    const result = await lintText(source);
    const diagnostics = result.results[0]?.diagnostics ?? [];
    expect(diagnostics.map((item) => item.ruleId)).toEqual(["no-unused-outline-variables"]);
    expect(diagnostics[0]?.start.line).toBe(14);
  });

  it.each([
    ["fr", "Fonctionnalité: Connexion\n  Scénario: valide\n    Étant donné un compte\n    Quand je me connecte\n    Alors je suis connecté\n"],
    ["de", "Funktionalität: Anmeldung\n  Szenario: gültig\n    Angenommen ein Konto\n    Wenn ich mich anmelde\n    Dann bin ich angemeldet\n"]
  ])("uses parser semantics for the %s dialect", async (language, body) => {
    const source = `# language: ${language}\n${body}`;
    const result = await lintText(source, {
      config: { extends: [], rules: { "logical-keyword-order": "error" } }
    });
    expect(result.summary.errors).toBe(0);
  });

  it("does not treat And or star steps as a new logical keyword stage", async () => {
    const source = `Feature: Keyword inheritance
  Scenario: conjunction after When
    When an event occurs
    And another event occurs
    * an implicit continuation occurs
    Then the result is visible
`;
    const result = await lintText(source, {
      config: { extends: [], rules: { "logical-keyword-order": "error" } }
    });
    expect(result.summary.errors).toBe(0);
  });

  it("reports duplicate tags and undefined placeholders at source locations", async () => {
    const source = `Feature: Variables
  @smoke @smoke
  Scenario Outline: use a value
    Given <unknown>

    Examples:
      | known |
      | value |
`;
    const result = await lintText(source);
    const diagnostics = result.results[0]?.diagnostics ?? [];
    expect(diagnostics.map((item) => item.ruleId)).toEqual(["no-duplicate-tags", "no-undefined-outline-variables", "no-unused-outline-variables"]);
    expect(diagnostics[1]?.start.line).toBe(4);
    expect(diagnostics[1]?.start.column).toBeGreaterThan(1);
  });

  it("treats Rule as a distinct Scenario name scope", async () => {
    const source = `Feature: Coupon
  Scenario: Apply
    Given an order exists

  Rule: Loyalty
    Scenario: Apply
      Given the customer has points
    Scenario: Apply
      Given the customer has enough points
`;
    const result = await lintText(source);
    expect(result.results[0]?.diagnostics.map((item) => item.ruleId)).toEqual(["no-duplicate-scenario-names"]);
    expect(result.results[0]?.diagnostics[0]?.start.line).toBe(8);
  });

  it("checks Feature size and both Feature and Rule Background sizes", async () => {
    const source = `Feature: Large workflow
  Background:
    Given one
    When two

  Scenario: first
    Given one

  Rule: Additional cases
    Background:
      Given one
      When two

    Scenario: second
      Given one
    Scenario: third
      Given one
`;
    const result = await lintText(source, {
      config: {
        extends: [],
        rules: {
          "background-size": ["error", { maxSteps: 1 }],
          "feature-size": ["error", { maxScenarios: 2 }]
        }
      }
    });
    expect(result.results[0]?.diagnostics.map((item) => item.ruleId)).toEqual([
      "feature-size",
      "background-size",
      "background-size"
    ]);
    expect(result.results[0]?.diagnostics.map((item) => item.start.line)).toEqual([1, 2, 10]);
  });

  it("respects warning and off severities and validates options before linting", async () => {
    const source = "Feature: F\n  Scenario: S\n    Given one\n    When two\n";
    const warning = await lintText(source, {
      config: { extends: [], rules: { "scenario-size": ["warn", { maxSteps: 1 }] } }
    });
    expect(warning.summary.warnings).toBe(1);
    expect(warning.summary.errors).toBe(0);
    const disabled = await lintText(source, {
      config: { extends: [], rules: { "no-duplicate-tags": "off" } }
    });
    expect(disabled.summary.errors).toBe(0);
    await expect(lintText(source, {
      config: { rules: { "scenario-size": ["error", { maxSteps: 0 }] } }
    })).rejects.toBeInstanceOf(ConfigError);
    await expect(lintText(source, { concurrency: 0 })).rejects.toBeInstanceOf(LintExecutionError);
    await expect(lintText(source, { maxWarnings: -1 })).rejects.toBeInstanceOf(LintExecutionError);
    await expect(lintFiles([], { fix: true, fixDryRun: true })).rejects.toBeInstanceOf(LintExecutionError);
  });

  it("rejects an already aborted API operation", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(lintText("Feature: F\n", { signal: controller.signal })).rejects.toBeInstanceOf(LintExecutionError);
    await expect(lintFiles([], { signal: controller.signal })).rejects.toBeInstanceOf(LintExecutionError);
  });

  it("turns parser failures into lint diagnostics", async () => {
    const result = await lintText("Feature: Broken\n  Scenario: Missing closing doc string\n    Given a value\n    \"\"\"\n    text\n");
    expect(result.results[0]?.diagnostics[0]?.ruleId).toBe("parsing-error");
    expect(result.results[0]?.diagnostics[0]?.start.line).toBeGreaterThan(0);
  });

  it("suppresses next-line and block diagnostics and reports unused directives", async () => {
    const source = `Feature: Suppression
  # gherkin-refine-disable-next-line no-duplicate-tags -- duplicate is fixture data
  @smoke @smoke
  Scenario: one
  # gherkinlint-disable name-length -- legacy threshold
  # gherkinlint-enable name-length
`;
    const result = await lintText(source, { reportUnusedDisableDirectives: true });
    expect(result.results[0]?.diagnostics.map((item) => item.ruleId)).toEqual(["unused-disable-directive"]);
    expect(result.results[0]?.diagnostics[0]?.data).toEqual({ reason: "legacy threshold" });
  });

  it("supports block suppression with multiple rule IDs", async () => {
    const source = `Feature: Suppression
  # gherkinlint-disable no-duplicate-tags,scenario-size -- legacy fixture
  @a @a
  Scenario: long flow
    Given one
    When two
  # gherkinlint-enable no-duplicate-tags scenario-size
  @b @b
  Scenario: short flow
    Given one
`;
    const result = await lintText(source, {
      config: { extends: [], rules: { "no-duplicate-tags": "error", "scenario-size": ["error", { maxSteps: 1 }] } }
    });
    expect(result.results[0]?.diagnostics.map((item) => item.ruleId)).toEqual(["no-duplicate-tags"]);
    expect(result.results[0]?.diagnostics[0]?.start.line).toBe(8);
  });

  it("reenables a selected rule after a blanket disable", async () => {
    const source = `# gherkin-refine-disable
Feature: Suppression
  # gherkin-refine-enable no-duplicate-tags
  @duplicate @duplicate
  Scenario: long scenario
    Given one
    When two
`;
    const result = await lintText(source, {
      reportUnusedDisableDirectives: true,
      config: {
        extends: [],
        rules: {
          "no-duplicate-tags": "error",
          "scenario-size": ["error", { maxSteps: 1 }]
        }
      }
    });

    expect(result.results[0]?.diagnostics.map((item) => item.ruleId)).toEqual(["no-duplicate-tags"]);
  });

  it("does not count an exempted blanket disable as used by a one-line directive", async () => {
    const source = `# gherkin-refine-disable
# gherkin-refine-enable no-duplicate-tags
Feature: Suppression
  # gherkin-refine-disable-next-line no-duplicate-tags
  @duplicate @duplicate
  Scenario: one
    Given a value
`;
    const result = await lintText(source, {
      reportUnusedDisableDirectives: true,
      config: { extends: [], rules: { "no-duplicate-tags": "error" } }
    });

    expect(result.results[0]?.diagnostics.map((item) => item.ruleId)).toEqual(["unused-disable-directive"]);
    expect(result.results[0]?.diagnostics[0]?.start.line).toBe(1);
  });

  it("limits disable-file directives to the listed rules", async () => {
    const source = `# gherkin-refine-disable-file name-length -- long names are allowed
Feature: F
  @duplicate @duplicate
  Scenario: a deliberately long scenario name
    Given a value
`;
    const result = await lintText(source, {
      reportUnusedDisableDirectives: true,
      config: {
        extends: [],
        rules: {
          "no-duplicate-tags": "error",
          "name-length": ["error", { max: 8 }]
        }
      }
    });

    expect(result.results[0]?.diagnostics.map((item) => item.ruleId)).toEqual(["no-duplicate-tags"]);
  });

  it("reports a disable directive that was enabled before a matching finding", async () => {
    const source = `# gherkin-refine-disable name-length
# gherkin-refine-enable name-length
Feature: F
  Scenario: a deliberately long scenario name
    Given a value
`;
    const result = await lintText(source, {
      reportUnusedDisableDirectives: true,
      config: { extends: [], rules: { "name-length": ["error", { max: 8 }] } }
    });

    expect(result.results[0]?.diagnostics.map((item) => item.ruleId)).toEqual([
      "unused-disable-directive",
      "name-length"
    ]);
  });

  it("awaits asynchronous plugin rules and reports rejected rules as execution errors", async () => {
    const cwd = await tempDirectory();
    const pluginDirectory = join(cwd, "node_modules", "gherkinlint-plugin-demo");
    await mkdir(pluginDirectory, { recursive: true });
    await writeFile(join(pluginDirectory, "package.json"), JSON.stringify({ name: "gherkinlint-plugin-demo", type: "module", main: "index.mjs" }));
    await symlink(pluginDirectory, join(cwd, "node_modules", "gherkin-refine-plugin-demo"), "dir");
    await writeFile(join(pluginDirectory, "index.mjs"), `export default { rules: {
      "async-check": { meta: { description: "Async check", category: "correctness", recommended: false }, async run({ report }) { await Promise.resolve(); report({ message: "Async result", start: { line: 1, column: 1 } }); } },
      "reject-check": { meta: { description: "Reject check", category: "correctness", recommended: false }, async run() { await Promise.reject(new Error("plugin failure")); } },
      "fix-one": { meta: { description: "First fix", category: "formatting", recommended: false, fixable: true }, run({ report }) { report({ message: "Fix one", start: { line: 1, column: 1 }, fix: { range: [0, 3], text: "One" } }); } },
      "fix-two": { meta: { description: "Second fix", category: "formatting", recommended: false, fixable: true }, run({ report }) { report({ message: "Fix two", start: { line: 1, column: 1 }, fix: { range: [2, 4], text: "Two" } }); } },
      "fix-safe": { meta: { description: "Safe fix", category: "formatting", recommended: false, fixable: true }, run({ report }) { report({ message: "Safe fix", start: { line: 1, column: 7 }, fix: { range: [6, 7], text: "S" } }); } }
    } };`);
    const config = { extends: [] as const, plugins: ["gherkin-refine-plugin-demo"], rules: { "demo/async-check": "warn" as const } };
    const result = await lintText("Feature: Plugin\n", { cwd, config });
    expect(result.results[0]?.diagnostics[0]?.message).toBe("Async result");
    expect(result.results[0]?.diagnostics[0]?.severity).toBe("warn");
    await expect(lintText("Feature: Plugin\n", {
      cwd,
      config: { extends: [], plugins: ["gherkinlint-plugin-demo"], rules: { "demo/reject-check": "error" } }
    })).rejects.toBeInstanceOf(LintExecutionError);
    const fixes = await lintText("Feature: Plugin\n", {
      cwd,
      fixDryRun: true,
      config: {
        extends: [],
        plugins: ["gherkinlint-plugin-demo"],
        rules: { "demo/fix-one": "error", "demo/fix-two": "error", "demo/fix-safe": "error" }
      }
    });
    expect(fixes.results[0]?.diagnostics.filter((item) => item.ruleId === "fix-conflict")).toHaveLength(2);
    expect(fixes.results[0]?.fixes).toHaveLength(1);
  });

  it("formats JSON, NDJSON, and SARIF as structured data", async () => {
    const result = await lintText("Feature: F\n  @a @a\n  Scenario: S\n");
    const json = JSON.parse(formatResult(result, "json"));
    expect(json.schemaVersion).toBe(1);
    const schema = JSON.parse(await readFile(new URL("../schemas/result.schema.json", import.meta.url), "utf8"));
    const validate = new Ajv2020({ strict: false }).compile(schema);
    expect(validate(json)).toBe(true);
    expect(formatResult(result, "ndjson").trim().split("\n").map((line) => JSON.parse(line).type)).toEqual(["summary", "file"]);
    const sarif = JSON.parse(formatResult(result, "sarif"));
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0].results[0].ruleId).toBe("no-duplicate-tags");
    expect(JSON.parse(formatResult(result, (value) => JSON.stringify({ fileCount: value.summary.files })))).toEqual({ fileCount: 1 });
  });

  it("converts legacy JSON comments and reports unsupported rules", () => {
    const result = migrateLegacyConfig({
      "no-duplicate-tags": "on",
      "no-unused-variables": "on",
      "custom-team-rule": "on"
    });
    expect(result.config.rules).toEqual({
      "no-duplicate-tags": "error",
      "no-unused-outline-variables": "error",
      "no-undefined-outline-variables": "error"
    });
    expect(result.unsupported).toEqual(["custom-team-rule: no equivalent rule"]);
  });
});

describe("lintFiles", () => {
  it("is deterministic across concurrency settings and keeps names with spaces", async () => {
    const cwd = await tempDirectory();
    const directory = join(cwd, "feature files");
    await mkdir(directory);
    await writeFile(join(directory, "a.feature"), "Feature: Same\n  Scenario: A\n");
    await writeFile(join(directory, "b.feature"), "Feature: Same\n  Scenario: B\n");
    const paths = ["feature files\\**\\*.feature"];
    const one = await lintFiles(paths, { cwd, concurrency: 1 });
    const many = await lintFiles(paths, { cwd, concurrency: 8 });
    expect(JSON.stringify(one)).toBe(JSON.stringify(many));
    expect(one.results.map((item) => item.filePath)).toEqual(["feature files/a.feature", "feature files/b.feature"]);
    expect(one.summary.errors).toBe(1);
  });

  it("does not modify a file in fix dry-run and applies idempotent CRLF fixes atomically", async () => {
    const cwd = await tempDirectory();
    const file = join(cwd, "trailing.feature");
    const source = "Feature: F  \r\n  Scenario: S\r\n    Given one  \r\n";
    await writeFile(file, source);
    const options = { cwd, config: { extends: [] as const, rules: { "no-trailing-whitespace": "error" as const } } };
    const dryRun = await lintFiles([file], { ...options, fixDryRun: true });
    expect(await readFile(file, "utf8")).toBe(source);
    expect(dryRun.results[0]?.fixes).toHaveLength(2);
    const fixed = await lintFiles([file], { ...options, fix: true });
    const expected = "Feature: F\r\n  Scenario: S\r\n    Given one\r\n";
    expect(await readFile(file, "utf8")).toBe(expected);
    expect(fixed.summary.errors).toBe(0);
    const second = await lintFiles([file], { ...options, fix: true });
    expect(second.results[0]?.fixes).toBeUndefined();
  });

  it("honors configured ignores while still linting directly named files", async () => {
    const cwd = await tempDirectory();
    await mkdir(join(cwd, "ignored"));
    const file = join(cwd, "ignored", "one.feature");
    await writeFile(file, "Feature: F\n  @a @a\n  Scenario: S\n");
    const config = { extends: [] as const, ignores: ["ignored/**/*.feature"], rules: { "no-duplicate-tags": "error" as const } };
    expect((await lintFiles(["."], { cwd, config })).summary.files).toBe(0);
    expect((await lintFiles([file], { cwd, config })).summary.errors).toBe(1);
  });

  it("adds .gherkin-lintignore patterns from the working directory to the configured ignores", async () => {
    const cwd = await tempDirectory();
    await mkdir(join(cwd, "vendor"));
    await mkdir(join(cwd, "generated"));
    await writeFile(join(cwd, "vendor", "one.feature"), "Feature: Vendor\n");
    await writeFile(join(cwd, "generated", "two.feature"), "Feature: Generated\n");
    await writeFile(join(cwd, "kept.feature"), "Feature: Kept\n");
    await writeFile(join(cwd, ".gherkin-lintignore"), "vendor/**\r\n\n");
    const config = { extends: [] as const, ignores: ["generated/**"] };

    const result = await lintFiles(["."], { cwd, config });

    expect(result.results.map((item) => item.filePath)).toEqual(["kept.feature"]);
  });

  it("keeps gherkin-lint negation semantics for .gherkin-lintignore lines", async () => {
    const cwd = await tempDirectory();
    await mkdir(join(cwd, "features"));
    await mkdir(join(cwd, "vendor"));
    for (const path of ["features/a.feature", "features/b.feature", "vendor/c.feature"]) await writeFile(join(cwd, path), "Feature: F\n");
    await writeFile(join(cwd, ".gherkin-lintignore"), "vendor/**\n!features/a.feature\n");

    const result = await lintFiles(["."], { cwd, config: { extends: [] } });

    expect(result.results.map((item) => item.filePath)).toEqual(["features/a.feature"]);
  });

  it("runs the rules of a .gherkin-lintrc in the working directory without the recommended preset", async () => {
    const cwd = await tempDirectory();
    await writeFile(join(cwd, ".gherkin-lintrc"), `{
      // legacy comment
      "no-trailing-spaces": "on",
      "custom-team-rule": "on"
    }`);
    await writeFile(join(cwd, "one.feature"), "Feature: F \n  Scenario: S\n  Scenario: S\n");

    const result = await lintFiles(["."], { cwd });

    expect(result.results[0]?.diagnostics.map((item) => item.ruleId)).toEqual(["no-trailing-whitespace"]);
  });

  it("prefers a native configuration and ignores a .gherkin-lintrc outside the working directory", async () => {
    const root = await tempDirectory();
    const cwd = join(root, "package");
    await mkdir(cwd);
    await writeFile(join(root, ".gherkin-lintrc"), JSON.stringify({ "no-trailing-spaces": "on" }));
    await writeFile(join(cwd, "one.feature"), "Feature: F \n");
    expect((await lintFiles(["."], { cwd })).summary.errors).toBe(0);

    await writeFile(join(cwd, ".gherkin-lintrc"), JSON.stringify({ "no-trailing-spaces": "on" }));
    expect((await lintFiles(["."], { cwd })).summary.errors).toBe(1);

    await writeFile(join(cwd, "gherkin-refine.config.json"), JSON.stringify({ extends: [] }));
    expect((await lintFiles(["."], { cwd })).summary.errors).toBe(0);
  });

  it("reports legacy rules that are not fully checked and loads an explicit .gherkin-lintrc", async () => {
    const cwd = await tempDirectory();
    const configPath = join(cwd, "config", ".gherkin-lintrc");
    await mkdir(join(cwd, "config"));
    await writeFile(configPath, JSON.stringify({ "custom-team-rule": "on", "another-custom-rule": "on", "name-length": "on", "no-duplicate-tags": "on" }));

    const loaded = await loadConfig(cwd, "config/.gherkin-lintrc");

    expect(loaded.legacyUnsupported).toEqual(["custom-team-rule", "another-custom-rule"]);
    expect(loaded.config.rules?.["no-duplicate-tags"]).toBe("error");
    expect((await loadConfig(cwd)).legacyUnsupported).toBeUndefined();
  });

  it("replaces .gherkin-lintignore with explicit ignore patterns", async () => {
    const cwd = await tempDirectory();
    await writeFile(join(cwd, "a.feature"), "Feature: A\n");
    await writeFile(join(cwd, "b.feature"), "Feature: B\n");
    await writeFile(join(cwd, ".gherkin-lintignore"), "a.feature\n");

    const result = await lintFiles(["."], { cwd, config: { extends: [] }, ignorePatterns: ["b.feature"] });

    expect(result.results.map((item) => item.filePath)).toEqual(["a.feature"]);
  });

  it("reports an unreadable .gherkin-lintignore as a configuration error", async () => {
    const cwd = await tempDirectory();
    await mkdir(join(cwd, ".gherkin-lintignore"));
    await expect(lintFiles(["."], { cwd, config: { extends: [] } })).rejects.toBeInstanceOf(ConfigError);
  });

  it("reports unmatched explicit glob patterns", async () => {
    const cwd = await tempDirectory();
    await expect(lintFiles(["missing/**/*.feature"], { cwd })).rejects.toThrow("Glob pattern did not match any files");
  });

  it.skipIf(process.platform === "win32")("follows a directly named symlinked directory without following nested links", async () => {
    const cwd = await tempDirectory();
    const target = join(cwd, "target");
    await mkdir(target);
    await writeFile(join(target, "one.feature"), "Feature: F\n");
    await symlink(target, join(cwd, "linked"), "dir");
    const result = await lintFiles(["linked"], { cwd });
    expect(result.summary.files).toBe(1);
    expect(result.results[0]?.filePath).toBe("linked/one.feature");
  });

  it("applies file overrides and loads erasable TypeScript configuration", async () => {
    const cwd = await tempDirectory();
    const legacyDirectory = join(cwd, "legacy");
    await mkdir(legacyDirectory);
    const current = join(cwd, "current.feature");
    const legacy = join(legacyDirectory, "old.feature");
    const source = "Feature: F\n  Scenario: S\n    Given one\n    When two\n";
    await writeFile(current, source);
    await writeFile(legacy, source);
    const overridden = await lintFiles([current, legacy], {
      cwd,
      config: {
        extends: [],
        rules: { "scenario-size": ["error", { maxSteps: 1 }] },
        overrides: [{ files: "legacy/**/*.feature", rules: { "scenario-size": ["warn", { maxSteps: 1 }] } }]
      }
    });
    expect(overridden.summary.errors).toBe(1);
    expect(overridden.summary.warnings).toBe(1);

    await writeFile(join(cwd, "gherkin-refine.config.ts"), `const maximum: number = 1;\nexport default { extends: [], rules: { "scenario-size": ["error", { maxSteps: maximum }] } };\n`);
    const fromTypeScript = await lintFiles([current], { cwd });
    expect(fromTypeScript.summary.errors).toBe(1);
    await rm(join(cwd, "gherkin-refine.config.ts"));
    await writeFile(join(cwd, "gherkinlint.config.ts"), `const maximum: number = 1;\nexport default { extends: [], rules: { "scenario-size": ["error", { maxSteps: maximum }] } };\n`);
    const fromLegacyTypeScript = await lintFiles([current], { cwd });
    expect(fromLegacyTypeScript.summary.errors).toBe(1);
  });
});
