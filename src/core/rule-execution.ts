import type { Diagnostic, LintDocument, RuleModule, Severity } from "../types.js";
import { effectiveConfig, type LoadedConfig } from "../config/index.js";
import { LintExecutionError, throwIfAborted } from "./errors.js";
import { compareText } from "./ordering.js";

export async function runFileRules(
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

export async function runProjectRules(
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
      throw ruleFailure(error, `Project rule ${ruleId}`, pluginFor(ruleId, loaded.pluginNames));
    }
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
    throw ruleFailure(error, `Rule ${ruleId}`, pluginFor(ruleId, pluginNames), ` for ${document.filePath}`);
  }
}

function pluginFor(ruleId: string, pluginNames: ReadonlyMap<string, string>): string {
  const namespace = ruleId.includes("/") ? ruleId.split("/")[0] : undefined;
  return namespace ? pluginNames.get(namespace) ?? namespace : "core";
}

function ruleFailure(error: unknown, subject: string, plugin: string, fileContext = ""): LintExecutionError {
  const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return new LintExecutionError(`${subject} from ${plugin} failed${fileContext}: ${reason}`, { cause: error });
}
