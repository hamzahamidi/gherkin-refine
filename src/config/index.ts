import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { minimatch } from "minimatch";
import type {
  LintConfig,
  PluginModule,
  ProjectRuleModule,
  RuleModule,
  RuleSetting,
  Severity
} from "../types.js";
import { fileRules, projectRules, recommendedRules } from "../rules/core.js";

export class ConfigError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConfigError";
  }
}

export interface LoadedConfig {
  readonly config: LintConfig;
  readonly fileRules: ReadonlyMap<string, RuleModule<unknown>>;
  readonly projectRules: ReadonlyMap<string, ProjectRuleModule<unknown>>;
  readonly pluginNames: ReadonlyMap<string, string>;
}

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

export async function loadConfig(cwd: string, explicitPath?: string): Promise<LoadedConfig> {
  const configPath = explicitPath ? resolve(cwd, explicitPath) : await findConfig(cwd);
  let config: LintConfig = {};
  if (configPath) {
    try {
      if (extname(configPath) === ".json") {
        const { readFile } = await import("node:fs/promises");
        config = JSON.parse(await readFile(configPath, "utf8")) as LintConfig;
      } else {
        const loaded = await import(pathToFileURL(configPath).href);
        config = (loaded.default ?? loaded) as LintConfig;
      }
    } catch (error) {
      throw new ConfigError(`Could not load configuration ${configPath}: ${messageOf(error)}`, { cause: error });
    }
  }
  return loadConfigObject(cwd, config);
}

export async function loadConfigObject(cwd: string, input: LintConfig): Promise<LoadedConfig> {
  validateConfigShape(input);
  const pluginSpecifiers = input.plugins ?? [];
  if (!Array.isArray(pluginSpecifiers) || !pluginSpecifiers.every((item) => typeof item === "string")) {
    throw new ConfigError("Configuration field plugins must be an array of package names.");
  }
  const plugins = await loadPlugins(cwd, pluginSpecifiers);
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
  const config = mergePresets(input, presets);
  return { config, fileRules: fileRuleMap, projectRules: projectRuleMap, pluginNames };
}

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

export function validateConfiguration(loaded: LoadedConfig, filePaths: readonly string[], cwd: string): void {
  const entries: { id: string; setting: Readonly<{ severity: Severity; options: unknown }>; filePath: string }[] = [];
  for (const filePath of filePaths) {
    const effective = effectiveConfig(loaded, filePath, cwd);
    for (const [id, setting] of effective.rules) entries.push({ id, setting, filePath });
  }
  for (const [id, setting] of Object.entries(loaded.config.rules ?? {})) entries.push({ id, setting: normalizeRuleSetting(setting), filePath: "configuration" });
  for (const override of loaded.config.overrides ?? []) {
    for (const [id, setting] of Object.entries(override.rules ?? {})) entries.push({ id, setting: normalizeRuleSetting(setting), filePath: "configuration override" });
  }
  for (const { id, setting, filePath } of entries) {
    const module = loaded.fileRules.get(id) ?? loaded.projectRules.get(id);
    if (!module) throw new ConfigError(`Unknown rule ${JSON.stringify(id)} in configuration.`);
    const options = setting.options ?? module.meta.defaultOptions ?? {};
    if (module.validateOptions && !module.validateOptions(options)) {
      throw new ConfigError(`Invalid options for rule ${JSON.stringify(id)} in ${filePath}.`);
    }
  }
  for (const filePath of filePaths) {
    const effective = effectiveConfig(loaded, filePath, cwd);
    for (const [id, setting] of effective.rules) {
      const module = loaded.fileRules.get(id) ?? loaded.projectRules.get(id);
      if (!module) throw new ConfigError(`Unknown rule ${JSON.stringify(id)} in configuration.`);
      if (module.validateOptions && !module.validateOptions(setting.options ?? module.meta.defaultOptions ?? {})) {
        throw new ConfigError(`Invalid options for rule ${JSON.stringify(id)} in ${filePath}.`);
      }
    }
  }
}

function validateConfigShape(config: unknown): asserts config is LintConfig {
  if (!isRecord(config)) throw new ConfigError("Configuration must export an object.");
  if (config.extends !== undefined && (!Array.isArray(config.extends) || !config.extends.every((item) => typeof item === "string"))) {
    throw new ConfigError("Configuration field extends must be an array of preset names.");
  }
  if (config.rules !== undefined && !isRecord(config.rules)) throw new ConfigError("Configuration field rules must be an object.");
  if (config.overrides !== undefined && (!Array.isArray(config.overrides) || !config.overrides.every(isRecord))) {
    throw new ConfigError("Configuration field overrides must be an array of objects.");
  }
  if (config.ignores !== undefined && (!Array.isArray(config.ignores) || !config.ignores.every((item) => typeof item === "string"))) {
    throw new ConfigError("Configuration field ignores must be an array of glob patterns.");
  }
  if (config.plugins !== undefined && (!Array.isArray(config.plugins) || !config.plugins.every((item) => typeof item === "string"))) {
    throw new ConfigError("Configuration field plugins must be an array of package names.");
  }
  if (config.reportUnusedDisableDirectives !== undefined && typeof config.reportUnusedDisableDirectives !== "boolean") {
    throw new ConfigError("Configuration field reportUnusedDisableDirectives must be a boolean.");
  }
  for (const field of ["maxConcurrency", "maxFixPasses"] as const) {
    const value = config[field];
    if (value !== undefined && (!Number.isInteger(value) || Number(value) < 1)) {
      throw new ConfigError(`Configuration field ${field} must be a positive integer.`);
    }
  }
  for (const [index, override] of (Array.isArray(config.overrides) ? config.overrides : []).entries()) {
    const files = override.files;
    if (!(typeof files === "string" || Array.isArray(files) && files.length > 0 && files.every((item) => typeof item === "string"))) {
      throw new ConfigError(`Configuration override ${index} requires files as a string or non-empty array of strings.`);
    }
    if (override.rules !== undefined && !isRecord(override.rules)) throw new ConfigError(`Configuration override ${index} rules must be an object.`);
    if (override.ignores !== undefined && (!Array.isArray(override.ignores) || !override.ignores.every((item) => typeof item === "string"))) {
      throw new ConfigError(`Configuration override ${index} ignores must be an array of glob patterns.`);
    }
  }
  for (const setting of [
    ...Object.values(isRecord(config.rules) ? config.rules : {}),
    ...(Array.isArray(config.overrides) ? config.overrides.flatMap((override) => Object.values(isRecord(override.rules) ? override.rules : {})) : [])
  ]) normalizeRuleSetting(setting as RuleSetting);
}

export function normalizeRuleSetting(setting: RuleSetting): Readonly<{ severity: Severity; options: unknown }> {
  let severityInput: unknown = setting;
  let options: unknown;
  if (Array.isArray(setting)) {
    if (setting.length < 1 || setting.length > 2) throw new ConfigError("Rule setting arrays must contain a severity and optional options.");
    severityInput = setting[0];
    options = setting[1];
  }
  const severity = severityOf(severityInput);
  return { severity, options };
}

export function severityOf(input: unknown): Severity {
  if (input === "off" || input === 0) return "off";
  if (input === "warn" || input === 1) return "warn";
  if (input === "error" || input === 2) return "error";
  throw new ConfigError(`Invalid rule severity ${JSON.stringify(input)}. Use off, warn, error, 0, 1, or 2.`);
}

export async function findConfig(cwd: string): Promise<string | undefined> {
  let directory = resolve(cwd);
  for (;;) {
    for (const name of CONFIG_FILES) {
      const candidate = resolve(directory, name);
      try {
        const { access } = await import("node:fs/promises");
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
  void ignoredExtends;
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
  return { ...config, rules };
}

function qualifyRuleId(namespace: string, id: string): string {
  return id.includes("/") ? id : `${namespace}/${id}`;
}

async function loadPlugins(cwd: string, specifiers: readonly string[]) {
  const require = createRequire(pathToFileURL(resolve(cwd, "gherkin-refine.config.mjs")));
  const loaded = [];
  for (const specifier of [...new Set(specifiers)]) {
    try {
      const resolved = await resolvePluginPath(cwd, specifier, require);
      const imported = await import(pathToFileURL(resolved).href);
      const module = (imported.default ?? imported) as PluginModule;
      const namespace = namespaceFromPackageName(readPackageName(resolved) ?? specifier);
      loaded.push({ specifier, namespace, module });
    } catch (error) {
      throw new ConfigError(`Could not load plugin ${JSON.stringify(specifier)}: ${messageOf(error)}`, { cause: error });
    }
  }
  return loaded;
}

async function resolvePluginPath(cwd: string, specifier: string, require: ReturnType<typeof createRequire>): Promise<string> {
  try {
    return require.resolve(specifier);
  } catch {
    if (specifier.startsWith("file:")) return fileURLToPath(specifier);
    if (specifier.startsWith(".") || isAbsolute(specifier)) {
      const path = resolve(cwd, specifier);
      await import(pathToFileURL(path).href);
      return path;
    }
  }

  const segments = specifier.split("/");
  const packageName = specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0] ?? specifier;
  const subpath = segments.slice(packageName.startsWith("@") ? 2 : 1).join("/");
  let directory = resolve(cwd);
  for (;;) {
    const packageDirectory = resolve(directory, "node_modules", packageName);
    try {
      const manifest = JSON.parse(await readFile(resolve(packageDirectory, "package.json"), "utf8")) as {
        name?: string;
        main?: string;
        module?: string;
        exports?: unknown;
      };
      const exported = subpath
        ? `./${subpath}`
        : exportTarget(manifest.exports, ".") ?? manifest.module ?? manifest.main ?? "index.js";
      const target = resolve(packageDirectory, exported);
      const relativeTarget = relative(packageDirectory, target);
      if (relativeTarget.startsWith("..") || isAbsolute(relativeTarget)) throw new ConfigError(`Plugin ${specifier} resolves outside its package directory.`);
      return target;
    } catch (error) {
      if (error instanceof ConfigError) throw error;
    }
    const parent = resolve(directory, "..");
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(`Package resolution did not find ${specifier} from ${cwd}.`);
}

function exportTarget(exports: unknown, key: string): string | undefined {
  if (typeof exports === "string") return key === "." ? exports : undefined;
  if (Array.isArray(exports)) {
    for (const item of exports) {
      const target = exportTarget(item, key);
      if (target) return target;
    }
    return undefined;
  }
  if (!isRecord(exports)) return undefined;
  const subpathExports = Object.keys(exports).some((name) => name.startsWith("."));
  if (subpathExports) return exportTarget(exports[key], key);
  for (const condition of ["node", "import", "default", "require"]) {
    const target = exportTarget(exports[condition], key);
    if (target) return target;
  }
  return undefined;
}

function readPackageName(resolvedFile: string): string | undefined {
  const require = createRequire(import.meta.url);
  let directory = resolve(resolvedFile, "..");
  for (;;) {
    try {
      const manifestPath = resolve(directory, "package.json");
      const manifest = require(manifestPath) as { name?: unknown };
      return typeof manifest.name === "string" ? manifest.name : undefined;
    } catch {
      const parent = resolve(directory, "..");
      if (parent === directory) return undefined;
      directory = parent;
    }
  }
}

function namespaceFromPackageName(name: string): string {
  const last = name.split("/").at(-1) ?? name;
  return last.replace(/^gherkin-refine-plugin-/, "").replace(/^gherkinlint-plugin-/, "").replace(/^eslint-plugin-/, "");
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
