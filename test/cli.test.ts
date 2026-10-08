import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];
const cliPath = join(process.cwd(), "dist", "cli.js");

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("CLI", () => {
  it("keeps JSON stdout clean and uses exit code 1 for lint findings", () => {
    const run = spawnSync(process.execPath, [cliPath, "--stdin", "--stdin-filename", "features/input.feature", "--format", "json"], {
      input: "Feature: F\n  @a @a\n  Scenario: S\n",
      encoding: "utf8"
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toBe("");
    const output = JSON.parse(run.stdout);
    expect(output.schemaVersion).toBe(1);
    expect(output.summary.errors).toBe(1);
  });

  it("uses exit code 2 for invalid configuration and supports rule introspection", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gherkinlint-cli-"));
    directories.push(directory);
    const configPath = join(directory, "invalid.json");
    await writeFile(configPath, JSON.stringify({ rules: { "not-a-rule": "error" } }));
    const invalid = spawnSync(process.execPath, [cliPath, "--stdin", "--config", configPath], {
      cwd: directory,
      input: "Feature: F\n",
      encoding: "utf8"
    });
    expect(invalid.status).toBe(2);
    expect(invalid.stderr).toContain("Unknown rule");
    const listed = spawnSync(process.execPath, [cliPath, "--list-rules", "--format", "json"], { encoding: "utf8" });
    expect(JSON.parse(listed.stdout).rules.some((rule: { id: string }) => rule.id === "no-duplicate-tags")).toBe(true);
  });

  it("uses exit code 2 for invalid arguments and 0 for help", () => {
    const invalid = spawnSync(process.execPath, [cliPath, "--bogus"], { encoding: "utf8" });
    expect(invalid.status).toBe(2);
    expect(invalid.stderr).toContain("unknown option");

    const help = spawnSync(process.execPath, [cliPath, "--help"], { encoding: "utf8" });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("Usage:");
  });

  it("fails warning-only output when the max warning threshold is exceeded", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gherkinlint-warning-"));
    directories.push(directory);
    const configPath = join(directory, "config.json");
    const featurePath = join(directory, "one.feature");
    await writeFile(configPath, JSON.stringify({ extends: [], rules: { "scenario-size": ["warn", { maxSteps: 1 }] } }));
    await writeFile(featurePath, "Feature: F\n  Scenario: S\n    Given one\n    When two\n");
    const run = spawnSync(process.execPath, [cliPath, featurePath, "--config", configPath, "--max-warnings", "0", "--format", "json"], {
      cwd: directory,
      encoding: "utf8"
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toBe("");
    expect(JSON.parse(run.stdout).summary.warnings).toBe(1);
  });
});
