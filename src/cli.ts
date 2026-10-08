#!/usr/bin/env node
import { Command, CommanderError, InvalidArgumentError } from "commander";
import { resolve } from "node:path";
import { effectiveConfig, loadConfig } from "./config/index.js";
import { migrateLegacyFile } from "./compat/migrate.js";
import { lintFiles, lintText } from "./core/engine.js";
import { formatResult, type FormatterName } from "./formatters/index.js";
import type { RuleMeta } from "./types.js";
import { VERSION } from "./version.js";

const VALID_FORMATS: readonly FormatterName[] = ["stylish", "compact", "json", "ndjson", "sarif"];

export async function runCli(argv: readonly string[] = process.argv): Promise<void> {
  const program = new Command();
  program
    .name("gherkin-refine")
    .description("A deterministic Gherkin linter for Node.js, CI, and AI coding agents.")
    .version(VERSION)
    .argument("[paths...]", "Feature files, directories, or glob patterns")
    .option("-c, --config <path>", "Configuration file path")
    .option("--format <format>", "Output format", "stylish")
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
    .action(async (configFile: string) => {
      const options = migrateCommand.opts<{ dryRun?: boolean; output?: string; force?: boolean }>();
      const result = await migrateLegacyFile(resolve(configFile), {
        ...(options.dryRun !== undefined ? { dryRun: options.dryRun } : {}),
        ...(options.output ? { outputPath: options.output } : {}),
        ...(options.force !== undefined ? { force: options.force } : {})
      });
      process.stdout.write(result.content);
      for (const item of result.mapped) process.stderr.write(`mapped: ${item}\n`);
      for (const item of result.unsupported) process.stderr.write(`unsupported: ${item}\n`);
      if (!options.dryRun) process.stderr.write(`Wrote ${resolve(options.output ?? "gherkin-refine.config.json")}\n`);
    });

  try {
    await program.parseAsync([...argv]);
  } catch (error) {
    if (error instanceof CommanderError) {
      process.exitCode = error.exitCode;
      return;
    }
    const debug = process.argv.includes("--debug");
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(debug && error instanceof Error ? `${error.stack ?? message}\n` : `${message}\n`);
    process.exitCode = 2;
  }
}

async function executeLint(paths: readonly string[], rawOptions: Record<string, unknown>): Promise<void> {
  const format = rawOptions.format as FormatterName;
  if (!VALID_FORMATS.includes(format)) throw new Error(`Unknown output format ${JSON.stringify(rawOptions.format)}.`);
  if (rawOptions.fix && rawOptions.fixDryRun) throw new Error("Choose either --fix or --fix-dry-run, not both.");
  const cwd = process.cwd();
  const configPath = typeof rawOptions.config === "string" ? rawOptions.config : undefined;
  const loaded = await loadConfig(cwd, configPath);

  if (rawOptions.listRules) {
    printRuleList(loaded, format, cwd);
    return;
  }
  if (typeof rawOptions.explain === "string") {
    printRuleExplanation(loaded, rawOptions.explain, format, cwd);
    return;
  }
  if (typeof rawOptions.printConfig === "string") {
    const filePath = resolve(cwd, rawOptions.printConfig);
    const effective = effectiveConfig(loaded, filePath, cwd);
    const output = {
      filePath: rawOptions.printConfig.replaceAll("\\", "/"),
      ignored: effective.ignored,
      plugins: [...loaded.pluginNames.entries()].map(([namespace, packageName]) => ({ namespace, package: packageName })),
      rules: Object.fromEntries([...effective.rules.entries()].sort(([left], [right]) => compareText(left, right)).map(([id, setting]) => [id, [setting.severity, setting.options ?? {}]]))
    };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  const lintOptions = {
    cwd,
    ...(configPath ? { configPath } : {}),
    ...(typeof rawOptions.maxDiagnostics === "number" ? { maxDiagnostics: rawOptions.maxDiagnostics } : {}),
    ...(typeof rawOptions.maxWarnings === "number" ? { maxWarnings: rawOptions.maxWarnings } : {}),
    ...(typeof rawOptions.concurrency === "number" ? { concurrency: rawOptions.concurrency } : {}),
    ...(rawOptions.absolutePaths === true ? { absolutePaths: true } : {}),
    ...(rawOptions.fix === true ? { fix: true } : {}),
    ...(rawOptions.fixDryRun === true ? { fixDryRun: true } : {}),
    ...(rawOptions.reportUnusedDisableDirectives === true ? { reportUnusedDisableDirectives: true } : {})
  };

  let result;
  if (rawOptions.stdin === true) {
    if (paths.length > 0) throw new Error("Paths cannot be combined with --stdin.");
    const source = await readStdin();
    result = await lintText(source, { ...lintOptions, filePath: String(rawOptions.stdinFilename ?? "<stdin>") });
  } else {
    result = await lintFiles(paths, lintOptions);
  }

  const metadata = Object.fromEntries([
    ...[...loaded.fileRules.entries()].map(([id, rule]) => [id, rule.meta] as const),
    ...[...loaded.projectRules.entries()].map(([id, rule]) => [id, rule.meta] as const)
  ]) as Readonly<Record<string, RuleMeta>>;
  process.stdout.write(formatResult(result, format, { cwd, quiet: rawOptions.quiet === true, ruleMetadata: metadata }));
  process.exitCode = result.summary.errors > 0 || result.summary.warnings > Number(rawOptions.maxWarnings ?? Number.POSITIVE_INFINITY) ? 1 : 0;
}

function printRuleList(
  loaded: Awaited<ReturnType<typeof loadConfig>>,
  format: FormatterName,
  cwd: string
): void {
  const effective = effectiveConfig(loaded, "__rules__.feature", cwd);
  const rules = [...loaded.fileRules.entries(), ...loaded.projectRules.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([id, rule]) => ({
      id,
      ...rule.meta,
      severity: effective.rules.get(id)?.severity ?? (rule.meta.recommended ? "error" : "off")
    }));
  if (format === "json") {
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, rules }, null, 2)}\n`);
  } else if (format === "ndjson") {
    process.stdout.write(`${JSON.stringify({ type: "rules", schemaVersion: 1, rules })}\n`);
  } else {
    for (const rule of rules) process.stdout.write(`${rule.id}\t${rule.severity}\t${rule.description}\n`);
  }
  void cwd;
}

function printRuleExplanation(
  loaded: Awaited<ReturnType<typeof loadConfig>>,
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
    severity: setting?.severity ?? (rule.meta.recommended ? "error" : "off"),
    options: setting?.options ?? rule.meta.defaultOptions ?? {}
  };
  if (format === "json") process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  else process.stdout.write(`${ruleId}\n${rule.meta.description}\nseverity: ${output.severity}\noptions: ${JSON.stringify(output.options)}\nrecommended: ${rule.meta.recommended}\nfixable: ${rule.meta.fixable === true}\nexamples: ${JSON.stringify(output.examples)}\n${rule.meta.documentation ?? ""}\n`);
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

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

void runCli();
