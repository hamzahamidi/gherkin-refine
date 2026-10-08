import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lintFiles } from "../src/index.js";
import { LintExecutionError } from "../src/core/engine.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createPlugin(cwd: string): Promise<void> {
  const pluginDirectory = join(cwd, "node_modules", "gherkinlint-plugin-fix-check");
  await mkdir(pluginDirectory, { recursive: true });
  await writeFile(join(pluginDirectory, "package.json"), JSON.stringify({
    name: "gherkinlint-plugin-fix-check",
    type: "module",
    main: "index.mjs"
  }));
  await writeFile(join(pluginDirectory, "index.mjs"), `export default { rules: {
    "invalid-gherkin-fix": {
      meta: { description: "Invalid Gherkin fix", category: "formatting", recommended: false, fixable: true },
      run({ report }) { report({ message: "Break the feature", start: { line: 1, column: 1 }, fix: { range: [0, 7], text: "Scenario" } }); }
    },
    "out-of-range-fix": {
      meta: { description: "Out of range fix", category: "formatting", recommended: false, fixable: true },
      run({ document, report }) { report({ message: "Invalid range", start: { line: 1, column: 1 }, fix: { range: [0, document.source.length + 1], text: "" } }); }
    }
  } };`);
}

describe("autofix safety", () => {
  it("does not write a plugin fix that makes a feature file invalid", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "gherkin-refine-fix-"));
    directories.push(cwd);
    await createPlugin(cwd);
    const filePath = join(cwd, "one.feature");
    const source = "Feature: Valid\n  Scenario: Existing\n    Given a value\n";
    await writeFile(filePath, source);

    const result = await lintFiles([filePath], {
      cwd,
      fix: true,
      config: { extends: [], plugins: ["gherkinlint-plugin-fix-check"], rules: { "fix-check/invalid-gherkin-fix": "error" } }
    });

    expect(await readFile(filePath, "utf8")).toBe(source);
    expect(result.results[0]?.output).toBeUndefined();
    expect(result.results[0]?.fixes).toBeUndefined();
    expect(result.results[0]?.diagnostics.map(({ ruleId }) => ruleId)).toContain("parsing-error");
  });

  it("rejects plugin fix ranges outside the source and preserves the file", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "gherkin-refine-fix-"));
    directories.push(cwd);
    await createPlugin(cwd);
    const filePath = join(cwd, "one.feature");
    const source = "Feature: Valid\n";
    await writeFile(filePath, source);

    await expect(lintFiles([filePath], {
      cwd,
      fix: true,
      config: { extends: [], plugins: ["gherkinlint-plugin-fix-check"], rules: { "fix-check/out-of-range-fix": "error" } }
    })).rejects.toBeInstanceOf(LintExecutionError);
    expect(await readFile(filePath, "utf8")).toBe(source);
  });
});
