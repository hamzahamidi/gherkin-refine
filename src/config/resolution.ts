import { isAbsolute, relative } from "node:path";
import { minimatch } from "minimatch";
import type { EffectiveConfig, LoadedConfig } from "./index.js";
import type { RuleSetting, Severity } from "../types.js";
import { normalizeRuleSetting } from "./settings.js";

export function effectiveConfig(
  loaded: LoadedConfig,
  filePath: string,
  cwd: string
): EffectiveConfig {
  const relativePath = normalizePath(isAbsolute(filePath) ? relative(cwd, filePath) : filePath);
  const settings = new Map<string, RuleSetting>(Object.entries(loaded.config.rules ?? {}));
  let ignored = matchesAny(relativePath, loaded.config.ignores ?? []);
  for (const override of loaded.config.overrides ?? []) {
    if (matchesAny(relativePath, asArray(override.files))) {
      for (const [id, setting] of Object.entries(override.rules ?? {})) settings.set(id, setting);
      if (matchesAny(relativePath, override.ignores ?? [])) ignored = true;
    }
  }

  const rules = new Map<string, Readonly<{ severity: Severity; options: unknown }>>();
  for (const [id, setting] of settings) {
    const normalized = normalizeRuleSetting(setting);
    rules.set(id, normalized);
  }
  return { rules, ignored };
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function matchesAny(filePath: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => minimatch(filePath, normalizePath(pattern), { dot: true }));
}

function asArray(value: string | readonly string[]): readonly string[] {
  return typeof value === "string" ? [value] : value;
}
