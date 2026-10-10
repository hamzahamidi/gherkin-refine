import { randomUUID } from "node:crypto";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import type { Diagnostic, FileResult, LintDocument, LintOptions, LintResult, RuleFix, RuleModule, Severity } from "../types.js";
import { effectiveConfig, loadConfig, loadConfigObject, validateConfiguration, type LoadedConfig } from "../config/index.js";
import { parseGherkin } from "../parser/document.js";
import { applySuppressions } from "./suppressions.js";
import { VERSION } from "../version.js";
import { discoverFiles } from "./files.js";

export class LintExecutionError extends Error {
  readonly exitCode = 2;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LintExecutionError";
  }
}

interface SourceFile {
  readonly absolutePath: string;
  readonly displayPath: string;
  source: string;
}

interface ProcessedFile {
  readonly file: SourceFile;
  readonly document?: LintDocument;
  readonly diagnostics: readonly Diagnostic[];
  readonly appliedFixes: readonly RuleFix[];
  readonly output?: string;
}

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
  const results: ProcessedFile[] = new Array(files.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, files.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      const file = files[index];
      if (!file) return;
      results[index] = await processOne(file, loaded, cwd, options, allowFixes);
    }
  });
  await Promise.all(workers);

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

async function processOne(
  file: SourceFile,
  loaded: LoadedConfig,
  cwd: string,
  options: LintOptions,
  allowFixes: boolean
): Promise<ProcessedFile> {
  throwIfAborted(options.signal);
  const effective = effectiveConfig(loaded, file.displayPath, cwd);
  const canFix = allowFixes && options.fix === true;
  const maxPasses = loaded.config.maxFixPasses ?? 10;
  let currentSource = file.source;
  const appliedFixes: RuleFix[] = [];
  let finalDocument: LintDocument | undefined;
  let finalDiagnostics: readonly Diagnostic[];
  let passes = 0;

  for (;;) {
    const parsed = parseGherkin(currentSource, file.displayPath);
    if (!parsed.document) {
      if (currentSource !== file.source) {
        throw new LintExecutionError(`Autofix produced invalid Gherkin for ${file.displayPath}; no files were changed.`);
      }
      finalDocument = undefined;
      finalDiagnostics = parsed.errors.map((error) => ({
        filePath: file.displayPath,
        ruleId: "parsing-error",
        severity: "error",
        message: error.message,
        start: error.location,
        end: { line: error.location.line, column: error.location.column + 1 }
      }));
      break;
    }
    finalDocument = parsed.document;
    finalDiagnostics = await runFileRules(parsed.document, loaded, effective.rules, options.signal);
    if (!canFix || passes >= maxPasses) break;

    const activeDiagnostics = applySuppressions(parsed.document, finalDiagnostics, false);
    const selected = selectFixes(activeDiagnostics, file.displayPath);
    if (selected.conflicts.length > 0) {
      finalDiagnostics = [...finalDiagnostics, ...selected.conflicts];
      break;
    }
    if (selected.fixes.length === 0) break;
    currentSource = applyFixes(currentSource, selected.fixes);
    appliedFixes.push(...selected.fixes);
    passes += 1;
  }

  if (canFix && passes >= maxPasses && finalDocument && selectFixes(finalDiagnostics, file.displayPath).fixes.length > 0) {
    const line = finalDiagnostics.find((diagnostic) => diagnostic.fix)?.start.line ?? 1;
    finalDiagnostics = [...finalDiagnostics, {
      filePath: file.displayPath,
      ruleId: "fix-pass-limit",
      severity: "error",
      message: `Autofix stopped after ${maxPasses} passes.`,
      start: { line, column: 1 }
    }];
  }

  const dryRun = allowFixes && options.fixDryRun === true;
  let dryFixes: RuleFix[] = [];
  if (dryRun && finalDocument) {
    const selected = selectFixes(applySuppressions(finalDocument, finalDiagnostics, false), file.displayPath);
    dryFixes = selected.fixes;
    finalDiagnostics = [...finalDiagnostics, ...selected.conflicts];
  }
  const output = currentSource !== file.source ? currentSource : undefined;
  return {
    file,
    ...(finalDocument ? { document: finalDocument } : {}),
    diagnostics: finalDiagnostics,
    appliedFixes: dryRun ? dryFixes : appliedFixes,
    ...(output !== undefined ? { output } : {})
  };
}

async function runFileRules(
  document: LintDocument,
  loaded: LoadedConfig,
  settings: ReadonlyMap<string, Readonly<{ severity: Severity; options: unknown }>>,
  signal?: AbortSignal
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  for (const [ruleId, rule] of [...loaded.fileRules.entries()].sort(([left], [right]) => compareText(left, right))) {
    throwIfAborted(signal);
    const setting = settings.get(ruleId);
    if (!setting || setting.severity === "off") continue;
    await invokeRule(ruleId, rule, setting, document, diagnostics, signal, loaded.pluginNames);
  }
  return diagnostics;
}

async function invokeRule(
  ruleId: string,
  rule: RuleModule<unknown>,
  setting: Readonly<{ severity: Severity; options: unknown }>,
  document: LintDocument,
  diagnostics: Diagnostic[],
  signal: AbortSignal | undefined,
  pluginNames: ReadonlyMap<string, string>
): Promise<void> {
  const context = {
    document,
    options: setting.options ?? rule.meta.defaultOptions ?? {},
    signal: signal ?? new AbortController().signal,
    report(input: Omit<Diagnostic, "filePath" | "ruleId" | "severity">) {
      diagnostics.push({ ...input, filePath: document.filePath, ruleId, severity: setting.severity as Exclude<Severity, "off"> });
    }
  };
  try {
    await rule.run(context);
  } catch (error) {
    const namespace = ruleId.includes("/") ? ruleId.split("/")[0] ?? "" : undefined;
    const plugin = namespace ? pluginNames.get(namespace) ?? namespace : "core";
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    throw new LintExecutionError(`Rule ${ruleId} from ${plugin} failed for ${document.filePath}: ${reason}`, { cause: error });
  }
}

async function runProjectRules(
  documents: readonly LintDocument[],
  loaded: LoadedConfig,
  cwd: string,
  signal?: AbortSignal
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  throwIfAborted(signal);
  if (documents.length === 0) return diagnostics;
  const settingsByFile = new Map(documents.map((document) => [document.filePath, effectiveConfig(loaded, document.filePath, cwd).rules]));
  for (const [ruleId, rule] of [...loaded.projectRules.entries()].sort(([left], [right]) => compareText(left, right))) {
    throwIfAborted(signal);
    const settings = documents.flatMap((document) => {
      const setting = settingsByFile.get(document.filePath)?.get(ruleId);
      return setting && setting.severity !== "off" ? [{ document, setting }] : [];
    });
    const first = settings[0];
    if (!first) continue;
    const context = {
      documents,
      options: first.setting.options ?? rule.meta.defaultOptions ?? {},
      signal: signal ?? new AbortController().signal,
      report(input: Diagnostic) {
        const fileSetting = settingsByFile.get(input.filePath)?.get(ruleId);
        if (!fileSetting || fileSetting.severity === "off") return;
        diagnostics.push({ ...input, ruleId, severity: fileSetting.severity });
      }
    };
    try {
      await rule.run(context);
    } catch (error) {
      const namespace = ruleId.includes("/") ? ruleId.split("/")[0] ?? "" : undefined;
      const plugin = namespace ? loaded.pluginNames.get(namespace) ?? namespace : "core";
      const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      throw new LintExecutionError(`Project rule ${ruleId} from ${plugin} failed: ${reason}`, { cause: error });
    }
  }
  return diagnostics;
}

function selectFixes(diagnostics: readonly Diagnostic[], filePath: string): { fixes: RuleFix[]; conflicts: Diagnostic[] } {
  const candidates = diagnostics.flatMap((diagnostic) => diagnostic.fix ? [{ diagnostic, fix: diagnostic.fix }] : []);
  candidates.sort((left, right) => left.fix.range[0] - right.fix.range[0] || left.fix.range[1] - right.fix.range[1] || compareText(left.diagnostic.ruleId, right.diagnostic.ruleId));
  const conflicting = new Set<number>();
  for (let left = 0; left < candidates.length; left += 1) {
    const first = candidates[left];
    if (!first) continue;
    for (let right = left + 1; right < candidates.length; right += 1) {
      const second = candidates[right];
      if (!second) continue;
      const overlaps = fixesOverlap(first.fix, second.fix);
      if (!overlaps) continue;
      conflicting.add(left);
      conflicting.add(right);
    }
  }
  const fixes: RuleFix[] = [];
  const conflicts: Diagnostic[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (!candidate) continue;
    if (!conflicting.has(index)) {
      fixes.push(candidate.fix);
      continue;
    }
    conflicts.push({
      filePath,
      ruleId: "fix-conflict",
      severity: "error",
      message: `Autofix from ${candidate.diagnostic.ruleId} overlaps another proposed edit.`,
      start: candidate.diagnostic.start,
      data: { conflictingRule: candidate.diagnostic.ruleId }
    });
  }
  return { fixes, conflicts: dedupeDiagnostics(conflicts) };
}

function fixesOverlap(left: RuleFix, right: RuleFix): boolean {
  const [leftStart, leftEnd] = left.range;
  const [rightStart, rightEnd] = right.range;
  const leftInsert = leftStart === leftEnd;
  const rightInsert = rightStart === rightEnd;
  if (leftInsert && rightInsert) return leftStart === rightStart;
  if (leftInsert) return leftStart >= rightStart && leftStart <= rightEnd;
  if (rightInsert) return rightStart >= leftStart && rightStart <= leftEnd;
  return leftStart < rightEnd && rightStart < leftEnd;
}

function applyFixes(source: string, fixes: readonly RuleFix[]): string {
  let output = source;
  for (const fix of [...fixes].sort((left, right) => right.range[0] - left.range[0] || right.range[1] - left.range[1])) {
    if (fix.range[0] < 0 || fix.range[1] < fix.range[0] || fix.range[1] > output.length) {
      throw new LintExecutionError(`Autofix range ${fix.range.join(":")} is outside the source file.`);
    }
    output = output.slice(0, fix.range[0]) + fix.text + output.slice(fix.range[1]);
  }
  return output;
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

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new LintExecutionError("Lint operation was aborted.", { cause: signal.reason });
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

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function dedupeDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter((diagnostic) => {
    const key = `${diagnostic.filePath}:${diagnostic.start.line}:${diagnostic.start.column}:${diagnostic.ruleId}:${diagnostic.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const { realpath } = await import("node:fs/promises");
  const target = await realpath(path);
  const fileStat = await stat(target);
  const temporary = resolve(dirname(target), `.gherkin-refine-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode: fileStat.mode });
    await rename(temporary, target);
  } catch (error) {
    const { rm } = await import("node:fs/promises");
    await rm(temporary, { force: true });
    throw new LintExecutionError(`Could not write autofixed file ${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}
