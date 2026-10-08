import { mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import type * as FileSystem from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lintFiles } from "../src/index.js";
import { LintExecutionError } from "../src/core/engine.js";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof FileSystem>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

const directories: string[] = [];
afterEach(async () => {
  vi.mocked(rename).mockReset();
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe("atomic write failures", () => {
  it.each([new Error("rename failed"), "rename failed"])("preserves the source and removes temporary output on %j", async reason => {
    const cwd = await mkdtemp(join(tmpdir(), "gherkin-refine-write-"));
    directories.push(cwd);
    const path = join(cwd, "one.feature");
    const source = "Feature: F  \n";
    await writeFile(path, source);
    vi.mocked(rename).mockRejectedValueOnce(reason);
    const promise = lintFiles([path], { cwd, fix: true, config: { extends: [], rules: { "no-trailing-whitespace": "error" } } });
    await expect(promise).rejects.toBeInstanceOf(LintExecutionError);
    await expect(promise).rejects.toThrow(`Could not write autofixed file ${path}: rename failed`);
    await expect(promise).rejects.toHaveProperty("cause", reason);
    expect(await readFile(path, "utf8")).toBe(source);
    expect(await readdir(cwd)).toEqual(["one.feature"]);
  });
});
