import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lintFiles } from "../src/index.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("plugin configuration", () => {
  it("resolves plugins beside an explicit config and qualifies preset override rules", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "gherkin-refine-config-"));
    directories.push(cwd);
    const configDirectory = join(cwd, "config");
    const pluginDirectory = join(configDirectory, "node_modules", "gherkinlint-plugin-demo");
    await mkdir(pluginDirectory, { recursive: true });
    await mkdir(join(cwd, "features"), { recursive: true });
    await mkdir(join(cwd, "legacy"), { recursive: true });
    await writeFile(join(configDirectory, "gherkin-refine.config.json"), JSON.stringify({
      plugins: ["gherkinlint-plugin-demo"],
      extends: ["demo/recommended"]
    }));
    await writeFile(join(pluginDirectory, "package.json"), JSON.stringify({
      name: "gherkinlint-plugin-demo",
      type: "module",
      main: "index.mjs"
    }));
    await writeFile(join(pluginDirectory, "index.mjs"), `export default {
      rules: {
        check: {
          meta: { description: "Fixture rule", category: "correctness", recommended: false },
          run({ report }) { report({ message: "Fixture finding", start: { line: 1, column: 1 } }); }
        }
      },
      configs: {
        recommended: {
          rules: { check: "warn" },
          overrides: [{ files: "legacy/*.feature", rules: { check: "off" } }]
        }
      }
    };`);
    const featurePath = join(cwd, "features", "current.feature");
    const legacyPath = join(cwd, "legacy", "old.feature");
    await writeFile(featurePath, "Feature: Current\n");
    await writeFile(legacyPath, "Feature: Legacy\n");

    const result = await lintFiles([featurePath, legacyPath], {
      cwd,
      configPath: "config/gherkin-refine.config.json"
    });

    expect(result.results.map(({ filePath, diagnostics }) => [filePath, diagnostics.map(({ ruleId }) => ruleId)])).toEqual([
      ["features/current.feature", ["demo/check"]],
      ["legacy/old.feature", []]
    ]);
  });
});
