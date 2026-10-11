import { randomUUID } from "node:crypto";
import { readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import type { Diagnostic, FileResult, LintOptions, LintResult } from "../types.js";
import { effectiveConfig, loadConfig, loadConfigObject, validateConfiguration, type LoadedConfig } from "../config/index.js";
import { applySuppressions } from "./suppressions.js";
import { VERSION } from "../version.js";
import { discoverFiles } from "./files.js";
import { LintExecutionError, throwIfAborted } from "./errors.js";
import { compareText } from "./ordering.js";
import { runProjectRules } from "./rule-execution.js";
import { processOne, type ProcessedFile, type SourceFile } from "./process-file.js";

export { LintExecutionError } from "./errors.js";

export async function lintText(source: string, options: LintOptions = {}): Promise<LintResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  validateExecutionOptions(options);
  const requestedPath = options.filePath ?? "stdin.feature";
  const absolutePath = requestedPath.startsWith("<") ? resolve(cwd, "__stdin__.feature") : resolve(cwd, requestedPath);
  const displayPath = requestedPath.startsWith("<") ? requestedPath : displayFilePath(absolutePath, cwd, options.absolutePaths ?? false);
  const loaded = await loadRequestedConfig(cwd, options);
  validateConfiguration(loaded, [displayPath], cwd);
  throwIfAborted(options.signal);
  const file: SourceFile = { absolutePath, displayPath, source };
  const processed = await processFiles([file], loaded, cwd, options, true);
  return buildResult(processed, options);
}

export async function lintFiles(paths: readonly string[], options: LintOptions & { readonly concurrency?: number } = {}): Promise<LintResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  validateExecutionOptions(options);
  throwIfAborted(options.signal);
  const loaded = await loadRequestedConfig(cwd, options);
  validateConfiguration(loaded, [], cwd);
  const found = await discoverFiles(paths.length > 0 ? paths : ["."], cwd);
  throwIfAborted(options.signal);
  const selectedPaths = found.paths.filter((absolutePath) => {
    const displayPath = displayFilePath(absolutePath, cwd, options.absolutePaths ?? false);
    return found.explicitFiles.has(absolutePath) || !effectiveConfig(loaded, displayPath, cwd).ignored;
  });
  const displayPaths = selectedPaths.map((absolutePath) => displayFilePath(absolutePath, cwd, options.absolutePaths ?? false));
  validateConfiguration(loaded, displayPaths, cwd);
  const files = await mapBounded(selectedPaths, resolveConcurrency(options, loaded.config.maxConcurrency), async (absolutePath): Promise<SourceFile> => {
    throwIfAborted(options.signal);
    return {
      absolutePath,
      displayPath: displayFilePath(absolutePath, cwd, options.absolutePaths ?? false),
      source: await readFile(absolutePath, "utf8")
    };
  });
  files.sort((left, right) => compareText(left.displayPath, right.displayPath));
  const processed = await processFiles(files, loaded, cwd, options, true);

  if (options.fix) {
    for (const result of processed) {
      if (result.output === undefined || result.output === result.file.source) continue;
      throwIfAborted(options.signal);
      await atomicWrite(result.file.absolutePath, result.output);
      result.file.source = result.output;
    }
  }
  throwIfAborted(options.signal);
  return buildResult(processed, options);
}

async function loadRequestedConfig(cwd: string, options: LintOptions): Promise<LoadedConfig> {
  const loadOptions = options.ignorePatterns ? { ignorePatterns: options.ignorePatterns } : {};
  return options.config ? loadConfigObject(cwd, options.config, cwd, loadOptions) : loadConfig(cwd, options.configPath, loadOptions);
}

async function processFiles(
  files: readonly SourceFile[],
  loaded: LoadedConfig,
  cwd: string,
  options: LintOptions,
  allowFixes: boolean
): Promise<ProcessedFile[]> {
  const concurrency = resolveConcurrency(options, loaded.config.maxConcurrency);
  const results = await mapBounded(files, concurrency, (file) => processOne(file, loaded, cwd, options, allowFixes));

  const documents = results.flatMap((item) => item.document ? [item.document] : []);
  const projectDiagnostics = await runProjectRules(documents, loaded, cwd, options.signal);
  const byPath = new Map<string, Diagnostic[]>();
  for (const diagnostic of projectDiagnostics) {
    const list = byPath.get(diagnostic.filePath) ?? [];
    list.push(diagnostic);
    byPath.set(diagnostic.filePath, list);
  }
  return results.map((item) => {
    if (!item.document) return item;
    const diagnostics = [...item.diagnostics, ...(byPath.get(item.file.displayPath) ?? [])];
    const effective = effectiveConfig(loaded, item.file.displayPath, cwd);
    const unusedSetting = effective.rules.get("unused-disable-directive");
    const configuredUnused = loaded.config.reportUnusedDisableDirectives;
    const ruleEnablesUnused = unusedSetting !== undefined && unusedSetting.severity !== "off";
    const requestedUnused = options.reportUnusedDisableDirectives ?? configuredUnused ?? ruleEnablesUnused;
    const reportUnused = requestedUnused && unusedSetting?.severity !== "off";
    const unusedSeverity = unusedSetting?.severity === "error" ? "error" : "warn";
    const filtered = applySuppressions(item.document, diagnostics, reportUnused, unusedSeverity);
    return { ...item, diagnostics: filtered };
  });
}

function buildResult(processed: readonly ProcessedFile[], options: LintOptions): LintResult {
  const diagnostics = processed.flatMap((item) => item.diagnostics).sort(compareDiagnostics);
  const summary = {
    files: processed.length,
    errors: diagnostics.filter((diagnostic) => diagnostic.severity === "error").length,
    warnings: diagnostics.filter((diagnostic) => diagnostic.severity === "warn").length,
    fixable: diagnostics.filter((diagnostic) => diagnostic.fix !== undefined).length,
    truncated: false
  };
  const maxDiagnostics = options.maxDiagnostics;
  const limited = maxDiagnostics === undefined ? diagnostics : diagnostics.slice(0, maxDiagnostics);
  summary.truncated = limited.length < diagnostics.length;
  const byFile = new Map<string, Diagnostic[]>();
  for (const diagnostic of limited) {
    const list = byFile.get(diagnostic.filePath) ?? [];
    list.push(diagnostic);
    byFile.set(diagnostic.filePath, list);
  }
  const results: FileResult[] = processed.map((item) => ({
    filePath: item.file.displayPath,
    diagnostics: byFile.get(item.file.displayPath) ?? [],
    ...(item.appliedFixes.length > 0 ? { fixes: item.appliedFixes } : {}),
    ...(item.output !== undefined ? { output: item.output } : {})
  }));
  results.sort((left, right) => compareText(left.filePath, right.filePath));
  return { schemaVersion: 1, tool: { name: "gherkin-refine", version: VERSION }, summary, results };
}

function validateExecutionOptions(options: LintOptions): void {
  for (const [name, value] of [["max-diagnostics", options.maxDiagnostics], ["max-warnings", options.maxWarnings]] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
      throw new LintExecutionError(`--${name} must be a non-negative integer.`);
    }
  }
  if (options.concurrency !== undefined && (!Number.isInteger(options.concurrency) || options.concurrency < 1)) {
    throw new LintExecutionError("--concurrency must be a positive integer.");
  }
  if (options.fix && options.fixDryRun) throw new LintExecutionError("Choose either fix or fixDryRun, not both.");
  throwIfAborted(options.signal);
}

function resolveConcurrency(options: LintOptions, configured?: number): number {
  return Math.min(options.concurrency ?? configured ?? 8, 64);
}

async function mapBounded<T, U>(items: readonly T[], concurrency: number, map: (item: T) => Promise<U>): Promise<U[]> {
  const results = new Array<U>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await map(item);
    }
  });
  await Promise.all(workers);
  return results;
}

function displayFilePath(absolutePath: string, cwd: string, absolutePaths: boolean): string {
  const path = absolutePaths ? absolutePath : relative(cwd, absolutePath);
  return path.split(sep).join("/") || ".";
}

function compareDiagnostics(left: Diagnostic, right: Diagnostic): number {
  return compareText(left.filePath, right.filePath) ||
    left.start.line - right.start.line ||
    left.start.column - right.start.column ||
    compareText(left.ruleId, right.ruleId) ||
    compareText(left.message, right.message);
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const target = await realpath(path);
  const fileStat = await stat(target);
  const temporary = resolve(dirname(target), `.gherkin-refine-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode: fileStat.mode });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw new LintExecutionError(`Could not write autofixed file ${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}
