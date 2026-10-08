import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lintFiles, lintText } from "../src/index.js";
import { LintExecutionError } from "../src/core/engine.js";
import type { LintConfig } from "../src/types.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture(module: string): Promise<{ cwd: string; config: LintConfig }> {
  const cwd = await mkdtemp(join(tmpdir(), "gherkin-refine-boundaries-"));
  directories.push(cwd);
  const directory = join(cwd, "node_modules", "gherkin-refine-plugin-boundary");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "package.json"), JSON.stringify({ name: "gherkin-refine-plugin-boundary", type: "module", main: "index.mjs" }));
  await writeFile(join(directory, "index.mjs"), module);
  return { cwd, config: { extends: [], plugins: ["gherkin-refine-plugin-boundary"] } };
}

const meta = '{ description: "Boundary fixture", category: "correctness", recommended: false }';

describe("project plugin execution", () => {
  it("uses per-file severity and filters reports for disabled or unknown files", async () => {
    const { cwd, config } = await fixture(`export const projectRules = { check: {
      meta: { ...${meta}, defaultOptions: { expected: true } },
      validateOptions(options) { return options.expected === true; },
      async run({ documents, options, signal, report }) {
        await Promise.resolve();
        if (!options.expected || signal.aborted) throw new Error("Invalid context");
        for (const filePath of [...documents.map(d => d.filePath), "unknown.feature"]) {
          report({ filePath, ruleId: "ignored", severity: "error", message: "Project finding", start: { line: 1, column: 1 } });
        }
      }
    } };`);
    for (const name of ["a", "b", "c"]) await writeFile(join(cwd, `${name}.feature`), `Feature: ${name}\n`);
    const result = await lintFiles(["."], { cwd, signal: new AbortController().signal, config: {
      ...config, rules: { "boundary/check": ["error", { expected: true }] },
      overrides: [{ files: "b.feature", rules: { "boundary/check": "off" } }, { files: "c.feature", rules: { "boundary/check": "warn" } }]
    } });
    expect(result.summary).toMatchObject({ files: 3, errors: 1, warnings: 1 });
    expect(result.results.map(file => file.diagnostics.map(d => [d.ruleId, d.severity]))).toEqual([
      [["boundary/check", "error"]], [], [["boundary/check", "warn"]]
    ]);
  });

  it.each(["new Error('project failed')", "'project failed'"])("preserves the cause of a rejected project rule: %s", async (thrown) => {
    const { cwd, config } = await fixture(`export default { projectRules: { check: { meta: ${meta}, run() { throw ${thrown}; } } } };`);
    const promise = lintText("Feature: F\n", { cwd, config: { ...config, rules: { "boundary/check": "error" } } });
    await expect(promise).rejects.toBeInstanceOf(LintExecutionError);
    await expect(promise).rejects.toThrow(`Project rule boundary/check from gherkin-refine-plugin-boundary failed: ${thrown.startsWith("new") ? "Error: " : ""}project failed`);
    await expect(promise).rejects.toHaveProperty("cause", thrown.startsWith("new") ? expect.any(Error) : "project failed");
  });

  it("preserves non-Error file rule failures and the originating plugin", async () => {
    const { cwd, config } = await fixture(`export default { rules: { check: { meta: ${meta}, run() { throw "file failed"; } } } };`);
    const promise = lintText("Feature: F\n", { cwd, config: { ...config, rules: { "boundary/check": "error" } } });
    await expect(promise).rejects.toThrow("Rule boundary/check from gherkin-refine-plugin-boundary failed for stdin.feature: file failed");
    await expect(promise).rejects.toHaveProperty("cause", "file failed");
  });
});

describe("fix boundaries", () => {
  it("reports the pass limit and exposes the valid partial output", async () => {
    const { cwd, config } = await fixture(`export default { rules: { check: { meta: ${meta}, run({ report }) {
      report({ message: "Append title", start: { line: 1, column: 10 }, fix: { range: [10, 10], text: "x" } });
    } } } };`);
    const result = await lintText("Feature: F\n", { cwd, fix: true, config: { ...config, maxFixPasses: 2, rules: { "boundary/check": "error" } } });
    expect(result.results[0]?.output).toBe("Feature: Fxx\n");
    expect(result.results[0]?.fixes).toHaveLength(2);
    expect(result.results[0]?.diagnostics.map(d => d.ruleId)).toEqual(["fix-pass-limit", "boundary/check"]);
    expect(result.results[0]?.diagnostics[0]?.message).toBe("Autofix stopped after 2 passes.");
  });

  it.each([
    [[9, 9], [9, 9]],
    [[9, 9], [9, 10]],
    [[9, 10], [10, 10]],
    [[9, 11], [10, 12]]
  ])("rejects conflicting ranges %j and %j without writing", async (first, second) => {
    const { cwd, config } = await fixture(`export default { rules: {
      a: { meta: ${meta}, run({ report }) { report({ message: "first", start: { line: 1, column: 10 }, fix: { range: ${JSON.stringify(first)}, text: "X" } }); } },
      b: { meta: ${meta}, run({ report }) { report({ message: "second", start: { line: 1, column: 10 }, fix: { range: ${JSON.stringify(second)}, text: "Y" } }); } }
    } };`);
    const path = join(cwd, "one.feature");
    const source = "Feature: Name\n";
    await writeFile(path, source);
    const result = await lintFiles([path], { cwd, fix: true, config: { ...config, rules: { "boundary/a": "error", "boundary/b": "error" } } });
    expect(result.results[0]?.diagnostics.filter(d => d.ruleId === "fix-conflict")).toHaveLength(2);
    expect(result.results[0]?.fixes).toBeUndefined();
    expect(await readFile(path, "utf8")).toBe(source);
  });

  it("applies independent edits and insertion ordering deterministically", async () => {
    const { cwd, config } = await fixture(`export default { rules: { check: { meta: ${meta}, run({ document, report }) {
      if (!document.source.startsWith("Feature: Name")) return;
      for (const [range, text] of [[[9, 10], "S"], [[11, 12], "n"], [[13, 13], "!"]]) {
        report({ message: "edit", start: { line: 1, column: range[0] + 1 }, fix: { range, text } });
      }
    } } } };`);
    const result = await lintText("Feature: Name\n", { cwd, fix: true, config: { ...config, rules: { "boundary/check": "warn" } } });
    expect(result.results[0]?.output).toBe("Feature: Sane!\n");
    expect(result.summary.errors).toBe(0);
    expect(result.summary.warnings).toBe(0);
  });
});
