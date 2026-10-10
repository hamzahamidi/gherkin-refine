import { spawnSync } from "node:child_process";
import { closeSync, openSync, readFileSync } from "node:fs";
import { cp, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { lintFiles } from "../src/index.js";

const legacyCli = join(createRequire(import.meta.url).resolve("gherkin-lint/package.json"), "..", "dist/main.js");
const fixtures = join(import.meta.dirname, "fixtures/gherkin-lint-parity");

type Mode = "same" | "subset" | "count" | "files";

const cases: readonly (readonly [string, unknown, Mode, string?])[] = [
  ["no-unnamed-features", "on", "same"],
  ["no-unnamed-scenarios", "on", "same"],
  ["no-scenario-outlines-without-examples", "on", "same"],
  ["no-examples-in-scenarios", "on", "same"],
  ["no-empty-file", "on", "same"],
  ["no-files-without-scenarios", "on", "same"],
  ["no-empty-background", "on", "same"],
  ["no-partially-commented-tag-lines", "on", "same"],
  ["one-space-between-tags", "on", "same"],
  ["no-superfluous-tags", "on", "same"],
  ["use-and", "on", "same"],
  ["indentation", "on", "same"],
  ["indentation", ["on", { Feature: 0, Background: 2, Scenario: 2, Step: 4, Examples: 4, example: 6, "feature tag": 0, "scenario tag": 2 }], "same"],
  ["new-line-at-eof", ["on", "yes"], "same"],
  ["new-line-at-eof", ["on", "no"], "same"],
  ["file-name", "on", "same"],
  ["file-name", ["on", { style: "kebab-case" }], "same"],
  ["file-name", ["on", { style: "snake_case" }], "same"],
  ["required-tags", ["on", { tags: ["^@jira-\\d+$"] }], "same"],
  ["required-tags", ["on", { tags: ["@smoke"], ignoreUntagged: false }], "same"],
  ["no-restricted-patterns", ["on", { Global: ["todo"], Feature: ["^draft"], Scenario: ["fine"] }], "same"],
  ["allowed-tags", ["on", { tags: ["@a", "@b"], patterns: ["^@jira"] }], "same"],
  ["no-restricted-tags", ["on", { tags: ["@x"], patterns: ["smoke"] }], "same"],
  ["name-length", "on", "same"],
  ["name-length", ["on", { Feature: 30, Scenario: 40, Step: 50 }], "same"],
  ["scenario-size", ["on", { "steps-length": { Scenario: 3, Background: 1 } }], "files"],
  ["no-trailing-spaces", "on", "same", "no-trailing-whitespace"],
  ["no-duplicate-tags", "on", "same"],
  ["no-unused-variables", "on", "same", "no-unused-outline-variables"],
  ["no-dupe-feature-names", "on", "same", "no-duplicate-feature-names"],
  ["no-dupe-scenario-names", "on", "count", "no-duplicate-scenario-names"],
  ["no-dupe-scenario-names", ["on", "in-feature"], "same", "no-duplicate-scenario-names"],
  ["max-scenarios-per-file", ["on", { maxScenarios: 1 }], "files", "feature-size"],
  ["no-homogenous-tags", "on", "subset", "no-homogeneous-tags"],
  ["no-background-only-scenario", "on", "subset"],
  ["only-one-when", "on", "subset"]
];

let workspace = "";

beforeAll(async () => {
  workspace = await realpath(await mkdtemp(join(tmpdir(), "gherkin-lint-parity-")));
  await cp(fixtures, workspace, { recursive: true });
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

function key(filePath: string, line: number, mode: Mode): string {
  const file = relative(workspace, filePath).replaceAll("\\", "/");
  return mode === "files" ? file : `${file}:${Math.max(1, line)}`;
}

describe("gherkin-lint 4.2.4 comparison", () => {
  const table = cases.map(([rule, setting, mode, nativeId]) => ({ rule, setting, mode, nativeId: nativeId ?? rule }));
  it.each(table)("$rule $setting", async ({ rule, setting, mode, nativeId }) => {
    await writeFile(join(workspace, ".gherkin-lintrc"), JSON.stringify({ [rule]: setting }));

    // gherkin-lint calls process.exit before a piped stream drains, so its report goes to a file.
    const reportPath = join(workspace, "..", `${rule}-report.json`);
    const report = openSync(reportPath, "w");
    spawnSync(process.execPath, [legacyCli, "-f", "json"], { cwd: workspace, stdio: ["ignore", report, report] });
    closeSync(report);
    const legacyFiles = JSON.parse(readFileSync(reportPath, "utf8")) as { filePath: string; errors: { rule: string; line: number }[] }[];
    await rm(reportPath, { force: true });
    const legacy = legacyFiles.flatMap((file) => file.errors.filter((error) => error.rule === rule).map((error) => key(file.filePath, error.line, mode)));

    expect(legacy.length, "fixtures must trigger the rule").toBeGreaterThan(0);
    const result = await lintFiles(["."], { cwd: workspace });
    const native = result.results.flatMap((file) => file.diagnostics
      .filter((diagnostic) => diagnostic.ruleId === nativeId)
      .map((diagnostic) => key(join(workspace, file.filePath), diagnostic.start.line, mode)));

    if (mode === "same") expect([...native].sort()).toEqual([...legacy].sort());
    if (mode === "files") expect([...new Set(native)].sort()).toEqual([...new Set(legacy)].sort());
    if (mode === "count") expect(native).toHaveLength(legacy.length);
    if (mode === "subset") {
      const perFile = (keys: readonly string[]) => keys.reduce((counts, item) => counts.set(item.split(":")[0] ?? "", (counts.get(item.split(":")[0] ?? "") ?? 0) + 1), new Map<string, number>());
      const legacyCounts = perFile(legacy);
      for (const [file, count] of perFile(native)) expect(count, file).toBeLessThanOrEqual(legacyCounts.get(file) ?? 0);
      expect(native.length).toBeLessThan(legacy.length);
    }
  }, 30_000);
});
