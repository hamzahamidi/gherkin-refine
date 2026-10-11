import type { Diagnostic, LintDocument, LintOptions, RuleFix } from "../types.js";
import { effectiveConfig, type LoadedConfig } from "../config/index.js";
import { parseGherkin } from "../parser/document.js";
import { applySuppressions } from "./suppressions.js";
import { LintExecutionError, throwIfAborted } from "./errors.js";
import { applyFixes, selectFixes } from "./fixes.js";
import { runFileRules } from "./rule-execution.js";

export interface SourceFile {
  readonly absolutePath: string;
  readonly displayPath: string;
  source: string;
}

export interface ProcessedFile {
  readonly file: SourceFile;
  readonly document?: LintDocument;
  readonly diagnostics: readonly Diagnostic[];
  readonly appliedFixes: readonly RuleFix[];
  readonly output?: string;
}

interface FixPassResult {
  readonly source: string;
  readonly document?: LintDocument;
  readonly diagnostics: readonly Diagnostic[];
  readonly appliedFixes: readonly RuleFix[];
  readonly passes: number;
}

export async function processOne(
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
  const passResult = await runFixPasses(file, loaded, effective.rules, options, canFix, maxPasses);
  const diagnostics = addFixPassLimit(passResult, file, canFix, maxPasses);
  const dryRun = allowFixes && options.fixDryRun === true;
  const preview = dryRun ? previewFixes(passResult.document, diagnostics, file.displayPath) : undefined;
  const finalDiagnostics = preview ? [...diagnostics, ...preview.conflicts] : diagnostics;
  const output = passResult.source !== file.source ? passResult.source : undefined;

  return {
    file,
    ...(passResult.document ? { document: passResult.document } : {}),
    diagnostics: finalDiagnostics,
    appliedFixes: preview ? preview.fixes : passResult.appliedFixes,
    ...(output !== undefined ? { output } : {})
  };
}

async function runFixPasses(
  file: SourceFile,
  loaded: LoadedConfig,
  rules: ReturnType<typeof effectiveConfig>["rules"],
  options: LintOptions,
  canFix: boolean,
  maxPasses: number
): Promise<FixPassResult> {
  let source = file.source;
  let passes = 0;
  const appliedFixes: RuleFix[] = [];

  for (;;) {
    const parsed = parseGherkin(source, file.displayPath);
    if (!parsed.document) {
      if (source !== file.source) {
        throw new LintExecutionError(`Autofix produced invalid Gherkin for ${file.displayPath}; no files were changed.`);
      }
      return { source, diagnostics: parsingDiagnostics(parsed.errors, file.displayPath), appliedFixes, passes };
    }

    const diagnostics = await runFileRules(parsed.document, loaded, rules, options.signal);
    if (!canFix || passes >= maxPasses) return { source, document: parsed.document, diagnostics, appliedFixes, passes };

    const selected = selectFixes(applySuppressions(parsed.document, diagnostics, false), file.displayPath);
    if (selected.conflicts.length > 0) {
      return {
        source,
        document: parsed.document,
        diagnostics: [...diagnostics, ...selected.conflicts],
        appliedFixes,
        passes
      };
    }
    if (selected.fixes.length === 0) return { source, document: parsed.document, diagnostics, appliedFixes, passes };

    source = applyFixes(source, selected.fixes);
    appliedFixes.push(...selected.fixes);
    passes += 1;
  }
}

function parsingDiagnostics(errors: ReturnType<typeof parseGherkin>["errors"], filePath: string): Diagnostic[] {
  return errors.map((error) => ({
    filePath,
    ruleId: "parsing-error",
    severity: "error",
    message: error.message,
    start: error.location,
    end: { line: error.location.line, column: error.location.column + 1 }
  }));
}

function addFixPassLimit(
  result: FixPassResult,
  file: SourceFile,
  canFix: boolean,
  maxPasses: number
): readonly Diagnostic[] {
  if (!canFix || result.passes < maxPasses || !result.document || selectFixes(result.diagnostics, file.displayPath).fixes.length === 0) {
    return result.diagnostics;
  }

  const line = result.diagnostics.find((diagnostic) => diagnostic.fix)?.start.line ?? 1;
  return [...result.diagnostics, {
    filePath: file.displayPath,
    ruleId: "fix-pass-limit",
    severity: "error",
    message: `Autofix stopped after ${maxPasses} passes.`,
    start: { line, column: 1 }
  }];
}

function previewFixes(
  document: LintDocument | undefined,
  diagnostics: readonly Diagnostic[],
  filePath: string
): { readonly fixes: RuleFix[]; readonly conflicts: Diagnostic[] } | undefined {
  if (!document) return undefined;
  const selected = selectFixes(applySuppressions(document, diagnostics, false), filePath);
  return { fixes: selected.fixes, conflicts: selected.conflicts };
}
