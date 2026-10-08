import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { LintResult, RuleMeta } from "../types.js";
import { VERSION } from "../version.js";

export type FormatterName = "stylish" | "compact" | "json" | "ndjson" | "sarif";
export type CustomFormatter = (result: LintResult) => string;

export function formatResult(
  result: LintResult,
  format: FormatterName | CustomFormatter = "stylish",
  options: { readonly cwd?: string; readonly quiet?: boolean; readonly ruleMetadata?: Readonly<Record<string, RuleMeta>> } = {}
): string {
  const displayed = options.quiet
    ? {
        ...result,
        results: result.results.map((file) => ({
          ...file,
          diagnostics: file.diagnostics.filter((diagnostic) => diagnostic.severity === "error")
        }))
      }
    : result;
  if (typeof format === "function") return format(displayed);
  switch (format) {
    case "json":
      return `${JSON.stringify(machineResult(displayed), null, 2)}\n`;
    case "ndjson":
      return formatNdjson(displayed);
    case "sarif":
      return `${JSON.stringify(toSarif(displayed, options.cwd ?? process.cwd(), options.ruleMetadata ?? {}), null, 2)}\n`;
    case "compact":
      return formatCompact(displayed, options.quiet ?? false);
    case "stylish":
      return formatStylish(displayed, options.quiet ?? false);
  }
}

function machineResult(result: LintResult) {
  return {
    schemaVersion: result.schemaVersion,
    tool: result.tool,
    summary: result.summary,
    results: result.results.map(({ filePath, diagnostics, fixes }) => ({
      filePath,
      diagnostics,
      ...(fixes ? { fixes } : {})
    }))
  };
}

function formatNdjson(result: LintResult): string {
  const rows = [JSON.stringify({ type: "summary", schemaVersion: result.schemaVersion, tool: result.tool, summary: result.summary })];
  for (const file of result.results) {
    rows.push(JSON.stringify({ type: "file", filePath: file.filePath, diagnostics: file.diagnostics, ...(file.fixes ? { fixes: file.fixes } : {}) }));
  }
  return `${rows.join("\n")}\n`;
}

function formatStylish(result: LintResult, quiet: boolean): string {
  const lines: string[] = [];
  for (const file of result.results) {
    const diagnostics = quiet ? file.diagnostics.filter((item) => item.severity === "error") : file.diagnostics;
    if (diagnostics.length === 0) continue;
    lines.push(file.filePath);
    for (const diagnostic of diagnostics) {
      const severity = diagnostic.severity === "error" ? "error" : "warning";
      lines.push(`  ${diagnostic.start.line}:${diagnostic.start.column}  ${severity}  ${diagnostic.message}  ${diagnostic.ruleId}`);
    }
  }
  const label = quiet
    ? `${result.summary.errors} error${result.summary.errors === 1 ? "" : "s"}`
    : `${result.summary.errors} error${result.summary.errors === 1 ? "" : "s"}, ${result.summary.warnings} warning${result.summary.warnings === 1 ? "" : "s"}`;
  if (result.summary.truncated) lines.push("Diagnostics were truncated.");
  if (lines.length > 0) lines.push("", label);
  else lines.push(`✔ ${result.summary.files} file${result.summary.files === 1 ? "" : "s"} lint-free`);
  return `${lines.join("\n")}\n`;
}

function formatCompact(result: LintResult, quiet: boolean): string {
  const lines: string[] = [];
  for (const diagnostic of result.results.flatMap((file) => file.diagnostics)) {
    if (quiet && diagnostic.severity !== "error") continue;
    lines.push(`${diagnostic.filePath}:${diagnostic.start.line}:${diagnostic.start.column}: ${diagnostic.severity}: ${diagnostic.message} (${diagnostic.ruleId})`);
  }
  if (result.summary.truncated) lines.push("results truncated");
  lines.push(quiet ? `${result.summary.errors} errors` : `${result.summary.errors} errors, ${result.summary.warnings} warnings`);
  return `${lines.join("\n")}\n`;
}

function toSarif(result: LintResult, cwd: string, metadata: Readonly<Record<string, RuleMeta>>) {
  const ruleIds = [...new Set(result.results.flatMap((file) => file.diagnostics.map((item) => item.ruleId)))].sort(compareText);
  const rules = ruleIds.map((id) => ({
    id,
    shortDescription: { text: metadata[id]?.description ?? id },
    properties: {
      ...(metadata[id]?.category ? { tags: [metadata[id]?.category] } : {}),
      ...(metadata[id]?.recommended !== undefined ? { recommended: metadata[id]?.recommended } : {}),
      ...(metadata[id]?.fixable !== undefined ? { fixable: metadata[id]?.fixable } : {})
    }
  }));
  const results = result.results.flatMap((file) => file.diagnostics.map((diagnostic) => ({
    ruleId: diagnostic.ruleId,
    level: diagnostic.severity === "error" ? "error" : "warning",
    message: { text: diagnostic.message },
    locations: [{
      physicalLocation: {
        artifactLocation: { uri: toArtifactUri(file.filePath, cwd) },
        region: {
          startLine: diagnostic.start.line,
          startColumn: diagnostic.start.column,
          ...(diagnostic.end ? { endLine: diagnostic.end.line, endColumn: diagnostic.end.column } : {})
        }
      }
    }],
    ...(diagnostic.data ? { properties: diagnostic.data } : {})
  })));
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [{
      tool: {
        driver: {
          name: "gherkin-refine",
          version: VERSION,
          rules
        }
      },
      results
    }]
  };
}

function toArtifactUri(filePath: string, cwd: string): string {
  if (filePath.startsWith("<")) return pathToFileURL(resolve(cwd, "__stdin__.feature")).href;
  return pathToFileURL(resolve(cwd, filePath)).href;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
