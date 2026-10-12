#!/usr/bin/env node
import { Command, CommanderError, InvalidArgumentError } from "commander";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { effectiveConfig, loadConfig, type LoadedConfig } from "./config/index.js";
import { configuredRuleIds } from "./config/settings.js";
import { migrateLegacyFile } from "./compat/migrate.js";
import { lintFiles, lintText } from "./core/engine.js";
import { compareText } from "./core/ordering.js";
import { formatResult, type FormatterName } from "./formatters/index.js";
import type { LintOptions, LintResult, RuleMeta, Severity } from "./types.js";
import { VERSION } from "./version.js";

const VALID_FORMATS: ReadonlySet<string> = new Set<FormatterName>(["stylish", "compact", "json", "ndjson", "sarif"]);

export async function runCli(argv: readonly string[] = process.argv): Promise<void> {
  const program = new Command();
  program
    .name("gherkin-refine")
    .description("A deterministic Gherkin linter for Node.js, CI, and AI coding agents.")
    .version(VERSION)
    .argument("[paths...]", "Feature files, directories, or glob patterns")
    .option("-c, --config <path>", "Configuration file path")
    .option("-f, --format <format>", "Output format", "stylish")
    .option("--fix", "Apply safe autofixes")
    .option("--fix-dry-run", "Report safe autofixes without writing files")
    .option("--stdin", "Read Gherkin source from stdin")
    .option("--stdin-filename <path>", "File name used with --stdin", "<stdin>")
    .option("--max-diagnostics <count>", "Limit emitted diagnostics", parseNonNegativeInteger)
    .option("--max-warnings <count>", "Fail when warning count exceeds this value", parseNonNegativeInteger)
    .option("--concurrency <count>", "Maximum files linted concurrently", parsePositiveInteger)
    .option("--report-unused-disable-directives", "Report suppression comments that suppress no diagnostics")
    .option("--quiet", "Emit only errors")
    .option("--absolute-paths", "Use absolute file paths in results")
    .option("--list-rules", "List built-in and configured plugin rules")
    .option("--explain <rule-id>", "Explain a rule and its effective configuration")
    .option("--print-config <path>", "Print effective configuration for a file")
    .option("--debug", "Print stack traces for execution errors")
    .option("-i, --ignore <patterns>", "Comma-separated ignore patterns that replace .gherkin-lintignore", parseList)
    .option("-r, --rulesdir <directory>", "gherkin-lint compatibility: fails if the directory holds custom rules", collect, [])
    .exitOverride()
    .configureOutput({
      writeOut: (text) => process.stdout.write(text),
      writeErr: (text) => process.stderr.write(text)
    });

  program.action(async (paths: string[]) => {
    await executeLint(paths, program.opts());
  });

  const migrateCommand = program.command("migrate")
    .description("Convert a legacy .gherkin-lintrc JSON file")
    .argument("[config-file]", "Legacy JSON configuration", ".gherkin-lintrc")
    .option("--dry-run", "Print the generated configuration without writing a file")
    .option("--output <path>", "Output configuration path", "gherkin-refine.config.json")
    .option("--force", "Replace an existing output file")
    .option("--strict", "Fail without writing when a legacy rule cannot be fully migrated")
    .action(async (configFile: string) => {
      const options = migrateCommand.opts<{ dryRun?: boolean; output?: string; force?: boolean; strict?: boolean }>();
      const result = await migrateLegacyFile(resolve(configFile), {
        ...(options.dryRun !== undefined ? { dryRun: options.dryRun } : {}),
        ...(options.output ? { outputPath: options.output } : {}),
        ...(options.force !== undefined ? { force: options.force } : {}),
        ...(options.strict !== undefined ? { strict: options.strict } : {})
      });
      process.stdout.write(result.content);
      for (const item of result.mapped) process.stderr.write(`mapped: ${item}\n`);
      for (const item of result.unsupported) process.stderr.write(`unsupported: ${item}\n`);
      for (const item of result.notes) process.stderr.write(`note: ${item}\n`);
      if (!options.dryRun) process.stderr.write(`Wrote ${resolve(options.output ?? "gherkin-refine.config.json")}\n`);
    });

  try {
    await program.parseAsync([...argv]);
  } catch (error) {
    if (error instanceof CommanderError) {
      process.exitCode = error.exitCode === 0 ? 0 : 2;
      return;
    }
    const debug = process.argv.includes("--debug");
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(debug && error instanceof Error ? `${error.stack ?? message}\n` : `${message}\n`);
    process.exitCode = 2;
  }
}

async function executeLint(paths: readonly string[], rawOptions: Record<string, unknown>): Promise<void> {
  const format = validatedFormat(rawOptions);
  const cwd = process.cwd();
  const configPath = typeof rawOptions.config === "string" ? rawOptions.config : undefined;
  await rejectLegacyRuleDirectories(cwd, rawOptions.rulesdir as readonly string[]);
  const ignorePatterns = Array.isArray(rawOptions.ignore) ? rawOptions.ignore as readonly string[] : undefined;
  const loaded = await loadConfig(cwd, configPath, ignorePatterns ? { ignorePatterns } : {});
  if (runIntrospection(rawOptions, loaded, format, cwd)) return;

  const lintOptions = buildLintOptions(rawOptions, cwd, configPath, ignorePatterns);
  for (const id of configuredRuleIds(loaded.config)) {
    const ruleId = loaded.legacyRuleIds.get(id);
    if (ruleId) process.stderr.write(`warning: rule ID ${id} is deprecated; use ${ruleId}.\n`);
  }
  if (loaded.legacyUnsupported) {
    process.stderr.write(`warning: .gherkin-lintrc rules not fully checked: ${loaded.legacyUnsupported.join(", ")}. Run "gherkin-refine migrate --dry-run" for details.\n`);
  }
  const result = await runLint(paths, rawOptions, lintOptions);
  process.stdout.write(formatResult(result, format, { cwd, quiet: rawOptions.quiet === true, ruleMetadata: ruleMetadataOf(loaded) }));
  process.exitCode = exitCodeFor(result, rawOptions.maxWarnings);
}

function validatedFormat(rawOptions: Record<string, unknown>): FormatterName {
  const format = rawOptions.format as FormatterName;
  if (!VALID_FORMATS.has(format)) throw new Error(`Unknown output format ${JSON.stringify(rawOptions.format)}.`);
  if (rawOptions.fix && rawOptions.fixDryRun) throw new Error("Choose either --fix or --fix-dry-run, not both.");
  return format;
}

function exitCodeFor(result: LintResult, maxWarnings: unknown): number {
  return result.summary.errors > 0 || result.summary.warnings > Number(maxWarnings ?? Number.POSITIVE_INFINITY) ? 1 : 0;
}

function runIntrospection(rawOptions: Record<string, unknown>, loaded: LoadedConfig, format: FormatterName, cwd: string): boolean {
  if (rawOptions.listRules) {
    printRuleList(loaded, format, cwd);
  } else if (typeof rawOptions.explain === "string") {
    printRuleExplanation(loaded, rawOptions.explain, format, cwd);
  } else if (typeof rawOptions.printConfig === "string") {
    printEffectiveConfig(loaded, rawOptions.printConfig, cwd);
  } else {
    return false;
  }
  return true;
}

function buildLintOptions(
  rawOptions: Record<string, unknown>,
  cwd: string,
  configPath: string | undefined,
  ignorePatterns: readonly string[] | undefined
): LintOptions {
  return {
    cwd,
    ...(configPath ? { configPath } : {}),
    ...(typeof rawOptions.maxDiagnostics === "number" ? { maxDiagnostics: rawOptions.maxDiagnostics } : {}),
    ...(typeof rawOptions.maxWarnings === "number" ? { maxWarnings: rawOptions.maxWarnings } : {}),
    ...(typeof rawOptions.concurrency === "number" ? { concurrency: rawOptions.concurrency } : {}),
    ...(rawOptions.absolutePaths === true ? { absolutePaths: true } : {}),
    ...(rawOptions.fix === true ? { fix: true } : {}),
    ...(rawOptions.fixDryRun === true ? { fixDryRun: true } : {}),
    ...(rawOptions.reportUnusedDisableDirectives === true ? { reportUnusedDisableDirectives: true } : {}),
    ...(ignorePatterns ? { ignorePatterns } : {})
  };
}

async function runLint(paths: readonly string[], rawOptions: Record<string, unknown>, lintOptions: LintOptions): Promise<LintResult> {
  if (rawOptions.stdin !== true) return lintFiles(paths, lintOptions);
  if (paths.length > 0) throw new Error("Paths cannot be combined with --stdin.");
  const source = await readStdin();
  return lintText(source, { ...lintOptions, filePath: typeof rawOptions.stdinFilename === "string" ? rawOptions.stdinFilename : "<stdin>" });
}

function ruleMetadataOf(loaded: LoadedConfig): Readonly<Record<string, RuleMeta>> {
  return Object.fromEntries([
    ...[...loaded.fileRules.entries()].map(([id, rule]) => [id, rule.meta] as const),
    ...[...loaded.projectRules.entries()].map(([id, rule]) => [id, rule.meta] as const)
  ]);
}

function printEffectiveConfig(loaded: LoadedConfig, printConfig: string, cwd: string): void {
  const effective = effectiveConfig(loaded, resolve(cwd, printConfig), cwd);
  const output = {
    filePath: printConfig.replaceAll("\\", "/"),
    ignored: effective.ignored,
    plugins: [...loaded.pluginNames.entries()].map(([namespace, packageName]) => ({ namespace, package: packageName })),
    rules: Object.fromEntries([...effective.rules.entries()].sort(([left], [right]) => compareText(left, right)).map(([id, setting]) => [id, [setting.severity, setting.options ?? {}]]))
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

function printRuleList(
  loaded: LoadedConfig,
  format: FormatterName,
  cwd: string
): void {
  const effective = effectiveConfig(loaded, "__rules__.feature", cwd);
  const rules = [...loaded.fileRules.entries(), ...loaded.projectRules.entries()]
    .filter(([id]) => !loaded.legacyRuleIds.has(id))
    .sort(([left], [right]) => compareText(left, right))
    .map(([id, rule]) => ({
      id,
      ...rule.meta,
      severity: effectiveSeverity(rule.meta, effective.rules.get(id))
    }));
  if (format === "json") {
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, rules }, null, 2)}\n`);
  } else if (format === "ndjson") {
    process.stdout.write(`${JSON.stringify({ type: "rules", schemaVersion: 1, rules })}\n`);
  } else {
    for (const rule of rules) process.stdout.write(`${rule.id}\t${rule.severity}\t${rule.description}\n`);
  }
}

function printRuleExplanation(
  loaded: LoadedConfig,
  ruleId: string,
  format: FormatterName,
  cwd: string
): void {
  const rule = loaded.fileRules.get(ruleId) ?? loaded.projectRules.get(ruleId);
  if (!rule) throw new Error(`Unknown rule ${JSON.stringify(ruleId)}.`);
  const effective = effectiveConfig(loaded, "__explain__.feature", cwd);
  const setting = effective.rules.get(ruleId);
  const output = {
    id: ruleId,
    ...rule.meta,
    examples: rule.meta.examples ?? [],
    severity: effectiveSeverity(rule.meta, setting),
    options: setting?.options ?? rule.meta.defaultOptions ?? {}
  };
  if (format === "json") process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  else process.stdout.write(`${ruleId}\n${rule.meta.description}\nseverity: ${output.severity}\noptions: ${JSON.stringify(output.options)}\nrecommended: ${rule.meta.recommended}\nfixable: ${rule.meta.fixable === true}\nexamples: ${JSON.stringify(output.examples)}\n${rule.meta.documentation ?? ""}\n`);
}

function effectiveSeverity(meta: RuleMeta, setting: { readonly severity: Severity } | undefined): Severity {
  return setting?.severity ?? (meta.recommended ? "error" : "off");
}

function parseNonNegativeInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new InvalidArgumentError("Expected a non-negative integer.");
  return parsed;
}

function parsePositiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new InvalidArgumentError("Expected a positive integer.");
  return parsed;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

await runCli();

function parseList(value: string): readonly string[] {
  return value.split(",").map((item) => item.trim()).filter((item) => item !== "");
}

function collect(value: string, previous: readonly string[]): readonly string[] {
  return [...previous, value];
}

async function rejectLegacyRuleDirectories(cwd: string, directories: readonly string[]): Promise<void> {
  for (const directory of directories) {
    let entries: string[];
    try {
      entries = await readdir(resolve(cwd, directory));
    } catch {
      continue;
    }
    if (entries.some((entry) => entry.endsWith(".js"))) {
      throw new Error(`Custom gherkin-lint rules in ${directory} are not supported. Port them to a gherkin-refine plugin.`);
    }
  }
}
