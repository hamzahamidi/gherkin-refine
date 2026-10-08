import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigError } from "../src/config/index.js";
import { migrateLegacyConfig, migrateLegacyFile } from "../src/compat/migrate.js";

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
      "name-length": ["error", { max: 40 }]
    });
    expect(result.mapped).toContain("no-dupe-scenario-names -> no-duplicate-scenario-names (scope now includes the enclosing Rule)");
    expect(result.unsupported).toContain("scenario-size: Background limits need a separate rule.");
    expect(result.unsupported).toContain("name-length: Step-name limits do not have a modern equivalent.");
    expect(result.unsupported).toContain("unknown-rule: no equivalent rule");
    expect(result.unsupported).toContain("invalid-severity: unsupported setting");
    expect(result.content).toBe(`${JSON.stringify(result.config, null, 2)}\n`);
  });

  it("uses documented defaults when legacy size settings cannot be represented", () => {
    const result = migrateLegacyConfig({
      "scenario-size": "on",
      "name-length": "on",
      "no-dupe-scenario-names": "on"
    });

    expect(result.config.rules).toEqual({
      "scenario-size": ["error", { maxSteps: 12 }],
      "name-length": ["error", { max: 70 }],
      "no-duplicate-scenario-names": "error"
    });
    expect(result.unsupported).toEqual([
      "scenario-size: no Scenario limit was present, so the modern default is 12 steps.",
      "no-dupe-scenario-names: modern scope is within each Feature or Rule, not across all files."
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
