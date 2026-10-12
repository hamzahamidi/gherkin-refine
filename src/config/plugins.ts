import { createRequire, isBuiltin } from "node:module";
import { readFileSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { PluginModule } from "../types.js";
import { ConfigError, isRecord, messageOf } from "./errors.js";

interface LoadedPlugin {
  readonly specifier: string;
  readonly path: string;
  readonly namespace: string;
  readonly legacyNamespace?: string;
  readonly module: PluginModule;
}

export async function loadPlugins(cwd: string, specifiers: readonly string[]): Promise<LoadedPlugin[]> {
  const require = createRequire(pathToFileURL(resolve(cwd, "gherkin-refine.config.mjs")));
  const loaded: LoadedPlugin[] = [];
  for (const specifier of new Set(specifiers)) {
    try {
      if (isBuiltin(specifier)) throw new ConfigError(`${specifier} is a Node.js built-in module, not a plugin package or file.`);
      const resolved = await resolvePluginPath(cwd, specifier, require);
      const imported = await import(pathToFileURL(resolved).href);
      const module = (imported.default ?? imported) as PluginModule;
      const packageName = readPackageName(resolved);
      const namespace = namespaceFromPackageName(packageName ?? fileStem(specifier));
      const legacyNamespace = packageName === undefined ? namespaceFromPackageName(specifier) : namespace;
      loaded.push({ specifier, path: realpathSync(resolved), namespace, ...(legacyNamespace === namespace ? {} : { legacyNamespace }), module });
    } catch (error) {
      throw new ConfigError(`Could not load plugin ${JSON.stringify(specifier)}: ${messageOf(error)}`, { cause: error });
    }
  }
  return withDistinctNamespaces(loaded);
}

function withDistinctNamespaces(plugins: readonly LoadedPlugin[]): LoadedPlugin[] {
  const paths = new Map<string, Set<string>>();
  for (const plugin of plugins) paths.set(plugin.namespace, new Set([...(paths.get(plugin.namespace) ?? []), plugin.path]));
  const distinct = plugins.map((plugin) => (paths.get(plugin.namespace)?.size ?? 0) > 1 && plugin.legacyNamespace
    ? { specifier: plugin.specifier, path: plugin.path, namespace: plugin.legacyNamespace, module: plugin.module }
    : plugin);
  const owners = new Map<string, LoadedPlugin>();
  for (const plugin of distinct) {
    for (const namespace of [plugin.namespace, ...(plugin.legacyNamespace ? [plugin.legacyNamespace] : [])]) {
      const owner = owners.get(namespace);
      if (owner && owner.path !== plugin.path) {
        throw new ConfigError(`Plugins ${JSON.stringify(owner.specifier)} and ${JSON.stringify(plugin.specifier)} both use the namespace ${JSON.stringify(namespace)}.`);
      }
      owners.set(namespace, plugin);
    }
  }
  return distinct;
}

interface PackageManifest {
  readonly main?: string;
  readonly module?: string;
  readonly exports?: unknown;
}

async function resolvePluginPath(cwd: string, specifier: string, require: ReturnType<typeof createRequire>): Promise<string> {
  try {
    return require.resolve(specifier);
  } catch {
    const local = await resolveLocalPath(cwd, specifier);
    if (local) return local;
  }
  return resolveFromNodeModules(cwd, specifier);
}

async function resolveLocalPath(cwd: string, specifier: string): Promise<string | undefined> {
  if (specifier.startsWith("file:")) return fileURLToPath(specifier);
  if (!specifier.startsWith(".") && !isAbsolute(specifier)) return undefined;
  const path = resolve(cwd, specifier);
  await import(pathToFileURL(path).href);
  return path;
}

async function resolveFromNodeModules(cwd: string, specifier: string): Promise<string> {
  const { packageName, subpath } = splitPackageSpecifier(specifier);
  for (const directory of ancestorDirectories(resolve(cwd))) {
    const target = await packageEntry(resolve(directory, "node_modules", packageName), specifier, subpath);
    if (target) return target;
  }
  throw new Error(`Package resolution did not find ${specifier} from ${cwd}.`);
}

function splitPackageSpecifier(specifier: string): { packageName: string; subpath: string } {
  const segments = specifier.split("/");
  const packageName = specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0] ?? specifier;
  const subpath = segments.slice(packageName.startsWith("@") ? 2 : 1).join("/");
  return { packageName, subpath };
}

function* ancestorDirectories(start: string): Generator<string> {
  let directory = start;
  for (;;) {
    yield directory;
    const parent = resolve(directory, "..");
    if (parent === directory) return;
    directory = parent;
  }
}

async function packageEntry(packageDirectory: string, specifier: string, subpath: string): Promise<string | undefined> {
  const manifest = await readManifest(resolve(packageDirectory, "package.json"));
  if (!manifest) return undefined;
  const target = resolve(packageDirectory, packageEntryPath(manifest, specifier, subpath));
  const relativeTarget = relative(packageDirectory, target);
  if (relativeTarget.startsWith("..") || isAbsolute(relativeTarget)) throw new ConfigError(`Plugin ${specifier} resolves outside its package directory.`);
  return target;
}

async function readManifest(path: string): Promise<PackageManifest | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw new ConfigError(`Could not read ${path}: ${messageOf(error)}`, { cause: error });
  }
  return parseManifest(path, text);
}

function parseManifest(path: string, text: string): PackageManifest & { readonly name?: unknown } {
  let manifest: unknown;
  try {
    manifest = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`${path} is not valid JSON: ${messageOf(error)}`, { cause: error });
  }
  if (!isRecord(manifest)) throw new ConfigError(`${path} must contain a JSON object.`);
  return manifest;
}

function isMissing(error: unknown): boolean {
  return isRecord(error) && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

function packageEntryPath(manifest: PackageManifest, specifier: string, subpath: string): string {
  const fallback = manifest.module ?? manifest.main ?? "index.js";
  if (manifest.exports === undefined || manifest.exports === null) return subpath ? `./${subpath}` : fallback;
  const target = subpath.endsWith("/") ? undefined : conditionTarget(exportEntry(manifest.exports, subpath ? `./${subpath}` : "."));
  if (typeof target === "string") return target;
  if (subpath) throw new ConfigError(`Plugin ${specifier} is not exported by its package.`);
  return fallback;
}

function exportEntry(exports: unknown, request: string): unknown {
  if (!isRecord(exports) || !Object.keys(exports).some((key) => key.startsWith("."))) return request === "." ? exports : undefined;
  if (!request.includes("*") && Object.hasOwn(exports, request)) return exports[request];
  const pattern = Object.keys(exports)
    .filter((key) => patternMatch(key, request) !== undefined)
    .sort((left, right) => right.indexOf("*") - left.indexOf("*") || right.length - left.length)[0];
  return pattern === undefined ? undefined : substitute(exports[pattern], patternMatch(pattern, request) ?? "");
}

function patternMatch(pattern: string, request: string): string | undefined {
  const star = pattern.indexOf("*");
  if (star < 0 || pattern.includes("*", star + 1)) return undefined;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  if (!request.startsWith(prefix) || request === prefix) return undefined;
  if (suffix && (!request.endsWith(suffix) || request.length < pattern.length)) return undefined;
  return request.slice(prefix.length, request.length - suffix.length);
}

function substitute(target: unknown, match: string): unknown {
  if (typeof target === "string") return target.replaceAll("*", match);
  if (Array.isArray(target)) return target.map((item) => substitute(item, match));
  if (isRecord(target)) return Object.fromEntries(Object.entries(target).map(([condition, value]) => [condition, substitute(value, match)]));
  return target;
}

const ACTIVE_CONDITIONS = new Set(["node", "import", "default"]);

function conditionTarget(target: unknown): string | null | undefined {
  if (typeof target === "string" || target === null) return target;
  if (Array.isArray(target)) {
    for (const item of target) {
      const resolved = conditionTarget(item);
      if (resolved !== undefined) return resolved;
    }
    return undefined;
  }
  if (!isRecord(target)) return undefined;
  for (const [condition, value] of Object.entries(target)) {
    if (!ACTIVE_CONDITIONS.has(condition)) continue;
    const resolved = conditionTarget(value);
    if (resolved !== undefined) return resolved;
  }
  return undefined;
}

function readPackageName(resolvedFile: string): string | undefined {
  for (const directory of ancestorDirectories(resolve(resolvedFile, ".."))) {
    const path = resolve(directory, "package.json");
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (error) {
      if (isMissing(error)) continue;
      throw new ConfigError(`Could not read ${path}: ${messageOf(error)}`, { cause: error });
    }
    const manifest = parseManifest(path, text);
    return typeof manifest.name === "string" ? manifest.name : undefined;
  }
  return undefined;
}

function fileStem(specifier: string): string {
  const last = specifier.split(/[\\/]/).at(-1) ?? specifier;
  return last.slice(0, last.length - extname(last).length) || last;
}

function namespaceFromPackageName(name: string): string {
  const last = name.split("/").at(-1) ?? name;
  return last.replace(/^gherkin-refine-plugin-/, "").replace(/^gherkinlint-plugin-/, "").replace(/^eslint-plugin-/, "");
}
