import { access, readFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { LintConfig, ProjectRuleModule, RuleModule, Severity } from "../types.js";
import { fileRules, projectRules, recommendedRules } from "../rules/core.js";
import { migrateLegacyConfig, parseLegacyConfig } from "../compat/migrate.js";
import { ConfigError, isRecord, messageOf } from "./errors.js";
import { loadPlugins } from "./plugins.js";
import { validateConfigShape } from "./settings.js";

export interface LoadedConfig {
  readonly config: LintConfig;
  readonly fileRules: ReadonlyMap<string, RuleModule<unknown>>;
  readonly projectRules: ReadonlyMap<string, ProjectRuleModule<unknown>>;
  readonly pluginNames: ReadonlyMap<string, string>;
  readonly legacyUnsupported?: readonly string[];
}

export interface LoadConfigOptions {
  readonly ignorePatterns?: readonly string[];
}

const LEGACY_CONFIG_FILE = ".gherkin-lintrc";

export interface EffectiveConfig {
  readonly rules: ReadonlyMap<string, Readonly<{ severity: Severity; options: unknown }>>;
  readonly ignored: boolean;
}

const CONFIG_FILES = [
  "gherkin-refine.config.js",
  "gherkin-refine.config.mjs",
  "gherkin-refine.config.ts",
  "gherkin-refine.config.json",
  "gherkinlint.config.js",
  "gherkinlint.config.mjs",
  "gherkinlint.config.ts",
  "gherkinlint.config.json"
] as const;

export function defineConfig<T extends LintConfig>(config: T): T {
  return config;
}

export async function loadConfig(cwd: string, explicitPath?: string, options: LoadConfigOptions = {}): Promise<LoadedConfig> {
  const configPath = explicitPath ? resolve(cwd, explicitPath) : await findConfig(cwd);
  let config: LintConfig = {};
  let legacyUnsupported: readonly string[] | undefined;
  if (configPath) {
    try {
      if (basename(configPath) === LEGACY_CONFIG_FILE) {
        const migrated = migrateLegacyConfig(parseLegacyConfig(await readFile(configPath, "utf8")));
        config = migrated.config;
        legacyUnsupported = [...new Set(migrated.unsupported.map((item) => item.slice(0, item.indexOf(":"))))];
      } else if (extname(configPath) === ".json") {
        config = JSON.parse(await readFile(configPath, "utf8")) as LintConfig;
      } else {
        if (/\.[cm]?ts$/.test(configPath) && !(process.features as { typescript?: unknown }).typescript) {
          throw new Error(`TypeScript configuration needs Node.js 22.18 or later; this is Node.js ${process.versions.node}. Use a .js, .mjs, or .json configuration file.`);
        }
        const loaded = await import(pathToFileURL(configPath).href);
        config = (loaded.default ?? loaded) as LintConfig;
      }
    } catch (error) {
      throw new ConfigError(`Could not load configuration ${configPath}: ${messageOf(error)}`, { cause: error });
    }
  }
  const loaded = await loadConfigObject(cwd, config, configPath ? dirname(configPath) : cwd, options);
  return legacyUnsupported && legacyUnsupported.length > 0 ? { ...loaded, legacyUnsupported } : loaded;
}

export async function loadConfigObject(
  cwd: string,
  input: LintConfig,
  pluginResolutionDirectory = cwd,
  options: LoadConfigOptions = {}
): Promise<LoadedConfig> {
  validateConfigShape(input);
  const pluginSpecifiers = input.plugins ?? [];
  if (!Array.isArray(pluginSpecifiers) || !pluginSpecifiers.every((item) => typeof item === "string")) {
    throw new ConfigError("Configuration field plugins must be an array of package names.");
  }
  const plugins = await loadPlugins(pluginResolutionDirectory, pluginSpecifiers);
  const fileRuleMap = new Map<string, RuleModule<unknown>>(Object.entries(fileRules));
  const projectRuleMap = new Map<string, ProjectRuleModule<unknown>>(Object.entries(projectRules));
  const pluginNames = new Map<string, string>();

  for (const plugin of plugins) {
    pluginNames.set(plugin.namespace, plugin.specifier);
    for (const [id, rule] of Object.entries(plugin.module.rules ?? {})) {
      fileRuleMap.set(qualifyRuleId(plugin.namespace, id), rule);
    }
    for (const [id, rule] of Object.entries(plugin.module.projectRules ?? {})) {
      projectRuleMap.set(qualifyRuleId(plugin.namespace, id), rule);
    }
  }

  const presets = new Map<string, LintConfig>();
  presets.set("recommended", { rules: recommendedRules });
  for (const plugin of plugins) {
    for (const [name, preset] of Object.entries(plugin.module.configs ?? {})) {
      presets.set(`${plugin.namespace}/${name}`, qualifyConfig(plugin.namespace, preset));
    }
  }
  const merged = mergePresets(input, presets);
  const legacyIgnores = options.ignorePatterns ?? await readLegacyIgnoreFile(cwd);
  const config = legacyIgnores.length > 0 ? { ...merged, ignores: [...(merged.ignores ?? []), ...legacyIgnores] } : merged;
  return { config, fileRules: fileRuleMap, projectRules: projectRuleMap, pluginNames };
}

// gherkin-lint reads this file from the working directory and treats each non-empty line as a glob.
async function readLegacyIgnoreFile(cwd: string): Promise<readonly string[]> {
  try {
    const source = await readFile(resolve(cwd, ".gherkin-lintignore"), "utf8");
    return source.split(/\r?\n|\r/).filter((line) => line !== "");
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return [];
    throw new ConfigError(`Could not read ${resolve(cwd, ".gherkin-lintignore")}: ${messageOf(error)}`, { cause: error });
  }
}

export async function findConfig(cwd: string): Promise<string | undefined> {
  let directory = resolve(cwd);
  for (;;) {
    // gherkin-lint reads .gherkin-lintrc from the working directory only.
    for (const name of directory === resolve(cwd) ? [...CONFIG_FILES, LEGACY_CONFIG_FILE] : CONFIG_FILES) {
      const candidate = resolve(directory, name);
      try {
        await access(candidate);
        return candidate;
      } catch {
        // Continue searching the candidate names and parent directory.
      }
    }
    const parent = resolve(directory, "..");
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function mergePresets(input: LintConfig, presets: ReadonlyMap<string, LintConfig>): LintConfig {
  let merged: LintConfig = {};
  for (const name of input.extends ?? ["recommended"]) {
    const preset = presets.get(name);
    if (!preset) throw new ConfigError(`Unknown configuration preset ${JSON.stringify(name)}.`);
    merged = mergeConfigs(merged, preset);
  }
  const { extends: ignoredExtends, ...localConfig } = input;
  return mergeConfigs(merged, localConfig);
}

function mergeConfigs(left: LintConfig, right: LintConfig): LintConfig {
  return {
    ...left,
    ...right,
    rules: { ...left.rules, ...right.rules },
    overrides: [...(left.overrides ?? []), ...(right.overrides ?? [])],
    ignores: [...(left.ignores ?? []), ...(right.ignores ?? [])],
    plugins: [...(left.plugins ?? []), ...(right.plugins ?? [])]
  };
}

function qualifyConfig(namespace: string, config: LintConfig): LintConfig {
  const rules = Object.fromEntries(Object.entries(config.rules ?? {}).map(([id, setting]) => [qualifyRuleId(namespace, id), setting]));
  const overrides = config.overrides?.map((override) => ({
    ...override,
    ...(override.rules ? {
      rules: Object.fromEntries(Object.entries(override.rules).map(([id, setting]) => [qualifyRuleId(namespace, id), setting]))
    } : {})
  }));
  return { ...config, rules, ...(overrides ? { overrides } : {}) };
}

function qualifyRuleId(namespace: string, id: string): string {
  return id.includes("/") ? id : `${namespace}/${id}`;
}

export { ConfigError };

export { effectiveConfig } from "./resolution.js";

export { validateConfiguration } from "./check.js";

export { normalizeRuleSetting, severityOf } from "./settings.js";
