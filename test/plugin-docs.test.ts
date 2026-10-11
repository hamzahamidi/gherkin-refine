import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as api from "../src/index.js";

const PACKAGE_IMPORT = 'import { defineRule, forEachScenario } from "gherkin-refine";';
const FEATURE = "Feature: Tags\n\n  @a @b\n  Scenario: two tags\n    Given a step\n";

let cwd: string;
let example: string;

beforeAll(async () => {
  const docs = await readFile(new URL("../docs/plugins.md", import.meta.url), "utf8");
  example = /```ts\r?\n([\s\S]*?)```/.exec(docs)?.[1]?.replaceAll("\r\n", "\n") ?? "";
  cwd = await mkdtemp(join(tmpdir(), "gherkin-refine-docs-plugin-"));
  const directory = join(cwd, "node_modules", "gherkin-refine-plugin-max-tags");
  await mkdir(directory, { recursive: true });
  const javascript = ts.transpileModule(example, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 } }).outputText;
  expect(javascript).toContain(PACKAGE_IMPORT);
  await writeFile(join(directory, "index.js"), javascript.replace(PACKAGE_IMPORT, "const { defineRule, forEachScenario } = globalThis.gherkinRefineApi;"));
  await writeFile(join(directory, "package.json"), JSON.stringify({ name: "gherkin-refine-plugin-max-tags", type: "module", main: "index.js" }));
  Object.assign(globalThis, { gherkinRefineApi: api });
});

afterAll(async () => {
  Reflect.deleteProperty(globalThis, "gherkinRefineApi");
  await rm(cwd, { recursive: true, force: true });
});

function lintWith(setting: unknown) {
  return api.lintText(FEATURE, {
    cwd,
    filePath: "tags.feature",
    config: { extends: [], plugins: ["gherkin-refine-plugin-max-tags"], rules: { "max-tags/max-scenario-tags": setting as never } }
  });
}

describe("typed rule example in docs/plugins.md", () => {
  it("type-checks against the public API", () => {
    const file = join(cwd, "example.ts").replaceAll("\\", "/");
    const isExample = (path: string) => path.replaceAll("\\", "/") === file;
    const host = ts.createCompilerHost({});
    const readSource = host.readFile.bind(host);
    host.readFile = (path) => isExample(path) ? example : readSource(path);
    const fileExists = host.fileExists.bind(host);
    host.fileExists = (path) => isExample(path) || fileExists(path);
    const program = ts.createProgram([file], {
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true,
      exactOptionalPropertyTypes: true,
      noEmit: true,
      skipLibCheck: true,
      types: ["node"],
      paths: { "gherkin-refine": [resolve("src/index.ts")] }
    }, host);
    const messages = ts.getPreEmitDiagnostics(program).map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
    expect(messages).toEqual([]);
    expect(example).not.toMatch(/\bas\s+[A-Z]/);
  }, 30_000);

  it("reports above the configured limit", async () => {
    const result = await lintWith(["error", { max: 1 }]);
    expect(result.results[0]?.diagnostics.map((item) => [item.ruleId, item.message])).toEqual([
      ["max-tags/max-scenario-tags", "Scenario has 2 tags; the limit is 1."]
    ]);
  });

  it("falls back to defaultOptions", async () => {
    const result = await lintWith("error");
    expect(result.summary.errors).toBe(0);
  });

  it("rejects invalid options", async () => {
    await expect(lintWith(["error", { max: 0 }])).rejects.toThrow('Invalid options for rule "max-tags/max-scenario-tags"');
  });
});
