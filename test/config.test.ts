import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { lintFiles } from "../src/index.js";
import { ConfigError, defineConfig, effectiveConfig, findConfig, loadConfig, loadConfigObject, normalizeRuleSetting, validateConfiguration } from "../src/config/index.js";
import type { LintConfig } from "../src/types.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function tempDirectory(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "gherkin-refine-config-"));
  directories.push(cwd);
  return cwd;
}

describe("TypeScript configuration on older Node.js", () => {
  it.skipIf(Boolean((process.features as { typescript?: unknown }).typescript))("explains the Node.js requirement instead of failing to import", async () => {
    const cwd = await tempDirectory();
    await writeFile(join(cwd, "gherkin-refine.config.ts"), "export default { extends: [] };\n");
    await expect(loadConfig(cwd)).rejects.toThrow("TypeScript configuration needs Node.js 22.18 or later");
  });
});

describe("configuration validation", () => {
  it.each([
    [null, "must export an object"],
    [[], "must export an object"],
    [{ extends: "recommended" }, "extends"],
    [{ extends: [false] }, "extends"],
    [{ rules: [] }, "rules"],
    [{ overrides: {} }, "overrides"],
    [{ overrides: [null] }, "overrides"],
    [{ ignores: [1] }, "ignores"],
    [{ plugins: "demo" }, "plugins"],
    [{ plugins: [1] }, "plugins"],
    [{ reportUnusedDisableDirectives: "yes" }, "reportUnusedDisableDirectives"],
    [{ maxConcurrency: 0 }, "maxConcurrency"],
    [{ maxFixPasses: 1.5 }, "maxFixPasses"],
    [{ overrides: [{ files: [] }] }, "requires files"],
    [{ overrides: [{ files: [1] }] }, "requires files"],
    [{ overrides: [{ files: "*.feature", rules: [] }] }, "rules"],
    [{ overrides: [{ files: "*.feature", ignores: [false] }] }, "ignores"],
    [{ rules: { "name-length": [] } }, "Rule setting arrays"],
    [{ overrides: [{ files: "*.feature", rules: { "name-length": ["warn", {}, {}] } }] }, "Rule setting arrays"],
    [{ rules: { "name-length": "warning" } }, "Invalid rule severity"]
  ])("rejects invalid config %j", async (input, message) => {
    await expect(loadConfigObject(await tempDirectory(), input as LintConfig)).rejects.toThrow(message);
  });

  it.each([[0, "off"], [1, "warn"], [2, "error"], ["off", "off"], ["warn", "warn"], ["error", "error"]] as const)(
    "normalizes severity %s without losing options", (input, severity) => {
      expect(normalizeRuleSetting(input)).toEqual({ severity, options: undefined });
      expect(normalizeRuleSetting([input, { max: 20 }])).toEqual({ severity, options: { max: 20 } });
    }
  );

  it("retains defineConfig identity and merges overrides and ignore patterns", async () => {
    const input = { extends: [] as const, ignores: ["ignored/**"], rules: { "name-length": "warn" as const }, overrides: [
      { files: ["legacy/*.feature"], rules: { "name-length": "off" as const }, ignores: ["legacy/skip.feature"] },
      { files: "other/*.feature" }
    ] };
    expect(defineConfig(input)).toBe(input);
    const cwd = await tempDirectory();
    const loaded = await loadConfigObject(cwd, input);
    expect(effectiveConfig(loaded, join(cwd, "legacy", "one.feature"), cwd).rules.get("name-length")?.severity).toBe("off");
    expect(effectiveConfig(loaded, "legacy/skip.feature", cwd).ignored).toBe(true);
    expect(effectiveConfig(loaded, "ignored/one.feature", cwd).ignored).toBe(true);
    expect(effectiveConfig(loaded, ".\\other\\one.feature", cwd).ignored).toBe(false);
  });

  it("validates unmatched overrides and rejects unknown presets", async () => {
    const cwd = await tempDirectory();
    const loaded = await loadConfigObject(cwd, { extends: [], overrides: [{ files: "absent/**", rules: { "name-length": ["error", { max: 0 }] } }] });
    expect(() => validateConfiguration(loaded, [], cwd)).toThrow("configuration override");
    await expect(loadConfigObject(cwd, { extends: ["missing/preset"] })).rejects.toThrow("Unknown configuration preset");
  });

  it("finds parent configuration and respects explicit ESM and JSON paths", async () => {
    const cwd = await tempDirectory();
    const nested = join(cwd, "nested");
    await mkdir(nested);
    const json = join(cwd, "gherkin-refine.config.json");
    await writeFile(json, JSON.stringify({ extends: [], rules: { "name-length": "warn" } }));
    expect(await findConfig(nested)).toBe(json);
    expect((await loadConfig(nested)).config.rules).toEqual({ "name-length": "warn" });
    await writeFile(join(cwd, "named.mjs"), 'export const rules = { "name-length": "off" };');
    expect((await loadConfig(cwd, "named.mjs")).config.rules?.["name-length"]).toBe("off");
    await writeFile(join(cwd, "broken.json"), "{");
    await expect(loadConfig(cwd, "broken.json")).rejects.toThrow("Could not load configuration");
    await writeFile(join(cwd, "throw.mjs"), 'throw "configuration failed";');
    await expect(loadConfig(cwd, "throw.mjs")).rejects.toThrow("configuration failed");
    await expect(loadConfig(cwd, "missing.json")).rejects.toBeInstanceOf(ConfigError);
  });
});

describe("plugin resolution", () => {
  it.each([
    { exports: { ".": { import: "./index.mjs" } } },
    { exports: { ".": [null, { browser: "./missing.mjs" }, { node: { import: "./index.mjs" } }] } },
    { exports: { ".": { import: [null, "./index.mjs"] } } },
    { exports: { ".": { import: "./index.mjs" } }, module: "./index.mjs" },
    { exports: {}, main: "./index.mjs" },
    { exports: {} }
  ])("resolves import-only or legacy package entry points %j", async (manifest) => {
    const cwd = await tempDirectory();
    const pluginDirectory = join(cwd, "node_modules", "@fixture", "gherkin-refine-plugin-demo");
    await mkdir(pluginDirectory, { recursive: true });
    await writeFile(join(pluginDirectory, "package.json"), JSON.stringify({ name: "@fixture/gherkin-refine-plugin-demo", type: "module", ...manifest }));
    const module = 'export const rules = { check: { meta: { description: "check", category: "correctness", recommended: false }, run() {} } };';
    await writeFile(join(pluginDirectory, "index.mjs"), module);
    await writeFile(join(pluginDirectory, "index.js"), module);
    const nested = join(cwd, "nested");
    await mkdir(nested);
    const loaded = await loadConfigObject(nested, { extends: [], plugins: ["@fixture/gherkin-refine-plugin-demo"] });
    expect(loaded.fileRules.has("demo/check")).toBe(true);
    expect(loaded.pluginNames.get("demo")).toBe("@fixture/gherkin-refine-plugin-demo");
  });

  it("loads file URLs and relative modules and deduplicates plugin specifiers", async () => {
    const cwd = await tempDirectory();
    await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "eslint-plugin-local" }));
    const path = join(cwd, "plugin.mjs");
    await writeFile(path, 'export default { configs: { empty: { overrides: [{ files: "*.feature" }] } }, rules: { "other/check": { meta: { description: "check", category: "correctness", recommended: false }, run() {} } } };');
    for (const specifier of ["./plugin.mjs", path, pathToFileURL(path).href]) {
      const loaded = await loadConfigObject(cwd, { plugins: [specifier, specifier], extends: ["local/empty"] });
      expect(loaded.pluginNames.size).toBe(1);
      expect(loaded.fileRules.has("other/check")).toBe(true);
      expect(loaded.config.overrides).toEqual([{ files: "*.feature" }]);
    }
  });

  it("resolves package subpaths and presets without rule maps", async () => {
    const cwd = await tempDirectory();
    const directory = join(cwd, "node_modules", "gherkin-refine-plugin-demo");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "package.json"), JSON.stringify({ name: "gherkin-refine-plugin-demo", type: "module", exports: { ".": { import: "./index.mjs" } } }));
    await writeFile(join(directory, "sub.mjs"), 'export default { configs: { empty: {} } };');
    const loaded = await loadConfigObject(cwd, { plugins: ["gherkin-refine-plugin-demo/sub.mjs"], extends: ["demo/empty"] });
    expect(loaded.config.rules).toEqual({});
  });

  it("rejects missing plugins and package entry points outside the package", async () => {
    const cwd = await tempDirectory();
    await expect(loadConfigObject(cwd, { plugins: ["gherkin-refine-plugin-missing"] })).rejects.toThrow("Package resolution did not find");
    const directory = join(cwd, "node_modules", "gherkin-refine-plugin-escape");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "package.json"), JSON.stringify({ name: "gherkin-refine-plugin-escape", exports: { import: "../../outside.mjs" } }));
    await expect(loadConfigObject(cwd, { plugins: ["gherkin-refine-plugin-escape"] })).rejects.toThrow("resolves outside its package directory");
  });
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
