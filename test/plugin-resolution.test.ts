import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfigObject } from "../src/config/index.js";
import { loadPlugins } from "../src/config/plugins.js";
import { lintText } from "../src/index.js";

let root: string;
let project: string;

const plugin = (rule: string) => `export default { rules: { ${JSON.stringify(rule)}: { meta: { description: "x", category: "correctness", recommended: false }, run() {} } } };\n`;

async function pkg(base: string, name: string, manifest: Record<string, unknown> | string, files: Record<string, string | null>) {
  const directory = join(base, "node_modules", name);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "package.json"), typeof manifest === "string" ? manifest : JSON.stringify({ name, type: "module", ...manifest }));
  for (const [file, content] of Object.entries(files)) {
    await mkdir(join(directory, file, ".."), { recursive: true });
    await writeFile(join(directory, file), content ?? plugin(file));
  }
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "gherkin-refine-plugins-"));
  project = join(root, "project");
  await mkdir(join(project, "nested"), { recursive: true });
  await pkg(project, "gherkin-refine-plugin-main", { main: "index.js" }, { "index.js": null });
  await pkg(project, "gherkin-refine-plugin-none", {}, { "index.js": null });
  await pkg(project, "@scope/gherkin-refine-plugin-cond", { exports: { ".": { import: "./esm.js", require: "./cjs.js" } } }, { "esm.js": null, "cjs.js": null });
  await pkg(project, "esm-only", { exports: { ".": { import: "./esm.js" } } }, { "esm.js": null });
  await pkg(project, "esm-only-node", { exports: { node: { import: "./node.js" }, default: "./default.js" } }, { "node.js": null, "default.js": null });
  await pkg(project, "exports-string-import", { exports: { import: "./s.js" } }, { "s.js": null });
  await pkg(project, "exports-array", { exports: [{ import: "./a.js" }, "./b.js"] }, { "a.js": null, "b.js": null });
  await pkg(project, "exports-subpaths", { exports: { "./rules": { import: "./rules.js" }, ".": { import: "./main.js" } } }, { "rules.js": null, "main.js": null });
  await pkg(project, "module-field", { module: "m.js", exports: { "./x": "./x.js" } }, { "m.js": null, "x.js": null });
  await pkg(project, "escape", { exports: { ".": { import: "../../../outside.js" } } }, {});
  await pkg(project, "escape-subpath", { exports: { ".": { import: "./ok.js" } } }, { "ok.js": null });
  await pkg(project, "exports-null", { exports: null, main: "n.js" }, { "n.js": null });
  await pkg(project, "no-exports", { main: "index.js" }, { "index.js": null, "sub/s.js": null });
  await pkg(project, "wildcard", { exports: { ".": { import: "./main.js" }, "./rules/*": { import: "./lib/*.js" }, "./rules/private/*": null } }, { "main.js": null, "lib/a.js": null, "lib/private/b.js": null });
  await pkg(project, "malformed", "{ not json", { "index.js": null });
  await pkg(root, "malformed", { exports: { import: "./parent.js" } }, { "parent.js": null });
  await pkg(project, "null-manifest", "null", { "index.js": null });
  await pkg(project, "exports-no-match", { exports: { browser: "./b.js" } }, { "b.js": null, "index.js": null });
  await pkg(project, "eslint-plugin-gherkin", { exports: { import: "./e.js" } }, { "e.js": null });
  await pkg(project, "gherkinlint-plugin-old", { main: "o.js" }, { "o.js": null });
  await pkg(project, "throws-on-import", { exports: { import: "./t.js" } }, { "t.js": "throw new Error('boom');\n" });
  await pkg(project, "@scope/deep", { exports: { import: "./d.js" } }, { "d.js": null });
  await pkg(root, "parent-installed", { exports: { import: "./p.js" } }, { "p.js": null });
  await writeFile(join(project, "local-plugin.mjs"), plugin("local"));
  await writeFile(join(project, "broken-local.mjs"), "export default {;\n");
  await writeFile(join(root, "outside.js"), plugin("outside"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function resolveFrom(cwd: string, specifiers: readonly string[]) {
  const loaded = await loadPlugins(cwd, specifiers);
  return loaded.map(({ specifier, namespace, module }) => [specifier, namespace, Object.keys(module.rules ?? {})]);
}

describe("plugin resolution", () => {
  it.each([
    ["gherkin-refine-plugin-main", "main", "index.js"],
    ["gherkin-refine-plugin-none", "none", "index.js"],
    ["@scope/gherkin-refine-plugin-cond", "cond", "cjs.js"],
    ["esm-only", "esm-only", "esm.js"],
    ["esm-only-node", "esm-only-node", "default.js"],
    ["exports-string-import", "exports-string-import", "s.js"],
    ["exports-array", "exports-array", "b.js"],
    ["exports-subpaths", "exports-subpaths", "main.js"],
    ["exports-subpaths/rules", "exports-subpaths", "rules.js"],
    ["wildcard/rules/a", "wildcard", "lib/a.js"],
    ["no-exports/sub/s.js", "no-exports", "sub/s.js"],
    ["module-field", "module-field", "m.js"],
    ["module-field/x", "module-field", "x.js"],
    ["exports-null", "exports-null", "n.js"],
    ["exports-no-match", "exports-no-match", "index.js"],
    ["eslint-plugin-gherkin", "gherkin", "e.js"],
    ["gherkinlint-plugin-old", "old", "o.js"],
    ["@scope/deep", "deep", "d.js"],
    ["parent-installed", "parent-installed", "p.js"]
  ])("loads %s as namespace %s", async (specifier, namespace, rule) => {
    for (const cwd of [project, join(project, "nested")]) {
      expect(await resolveFrom(cwd, [specifier])).toEqual([[specifier, namespace, [rule]]]);
    }
  });

  it("loads local plugins by relative path, absolute path and file URL", async () => {
    const absolute = join(project, "local-plugin.mjs");
    expect(await resolveFrom(project, ["./local-plugin.mjs", absolute, pathToFileURL(absolute).href])).toEqual([
      ["./local-plugin.mjs", "local-plugin", ["local"]],
      [absolute, "local-plugin", ["local"]],
      [pathToFileURL(absolute).href, "local-plugin", ["local"]]
    ]);
  });

  it("loads each specifier once", async () => {
    expect((await resolveFrom(project, ["esm-only", "esm-only", "./local-plugin.mjs"])).map(([specifier]) => specifier)).toEqual(["esm-only", "./local-plugin.mjs"]);
  });

  it.each([
    ["escape", "resolves outside its package directory"],
    ["escape-subpath/../../outside.js", "is not exported by its package"],
    ["escape-subpath/ok.js", "is not exported by its package"],
    ["wildcard/rules/private/b", "is not exported by its package"],
    ["malformed", "package.json is not valid JSON"],
    ["null-manifest", "package.json must contain a JSON object"],
    ["node:fs", "node:fs is a Node.js built-in module"],
    ["fs", "fs is a Node.js built-in module"],
    ["throws-on-import", "boom"],
    ["@scope", "Package resolution did not find @scope"],
    ["missing-package", "Package resolution did not find missing-package"],
    ["./broken-local.mjs", "broken-local.mjs"],
    ["./missing-local.mjs", "Cannot find module"],
    ["file:///nonexistent/plugin.mjs", "file:///nonexistent/plugin.mjs"]
  ])("rejects %s", async (specifier, message) => {
    await expect(resolveFrom(project, [specifier])).rejects.toThrow(`Could not load plugin ${JSON.stringify(specifier)}`);
    await expect(resolveFrom(project, [specifier])).rejects.toThrow(message);
  });
});

describe("path plugin namespaces", () => {
  const reporting = (rule: string) => `export default { rules: { ${JSON.stringify(rule)}: { meta: { description: "x", category: "correctness", recommended: false }, run({ report }) { report({ message: "found", start: { line: 1, column: 1 } }); } } } };\n`;

  it("drops the extension and keeps the previous ID working", async () => {
    await writeFile(join(project, "reporting-plugin.mjs"), reporting("check"));
    const loaded = await loadConfigObject(project, { extends: [], plugins: ["./reporting-plugin.mjs"] });
    expect([...loaded.fileRules.keys()].filter((id) => id.includes("reporting-plugin"))).toEqual(["reporting-plugin/check", "reporting-plugin.mjs/check"]);
    expect([...loaded.legacyRuleIds]).toEqual(["reporting-plugin.mjs/check"]);
    for (const id of ["reporting-plugin/check", "reporting-plugin.mjs/check"]) {
      const result = await lintText("Feature: x\n", { cwd: project, filePath: "x.feature", config: { extends: [], plugins: ["./reporting-plugin.mjs"], rules: { [id]: "error" } } });
      expect(result.results[0]?.diagnostics.map((item) => item.ruleId)).toEqual([id]);
    }
  });
});

