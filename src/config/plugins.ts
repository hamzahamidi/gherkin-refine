import { createRequire, isBuiltin } from "node:module";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { PluginModule } from "../types.js";
import { ConfigError, isRecord, messageOf } from "./errors.js";

export async function loadPlugins(cwd: string, specifiers: readonly string[]) {
  const require = createRequire(pathToFileURL(resolve(cwd, "gherkin-refine.config.mjs")));
  const loaded = [];
  for (const specifier of new Set(specifiers)) {
    try {
      if (isBuiltin(specifier)) throw new ConfigError(`${specifier} is a Node.js built-in module, not a plugin package or file.`);
      const resolved = await resolvePluginPath(cwd, specifier, require);
      const imported = await import(pathToFileURL(resolved).href);
      const module = (imported.default ?? imported) as PluginModule;
      const packageName = readPackageName(resolved);
      const namespace = namespaceFromPackageName(packageName ?? fileStem(specifier));
      const legacyNamespace = packageName === undefined ? namespaceFromPackageName(specifier) : namespace;
      loaded.push({ specifier, namespace, ...(legacyNamespace === namespace ? {} : { legacyNamespace }), module });
    } catch (error) {
      throw new ConfigError(`Could not load plugin ${JSON.stringify(specifier)}: ${messageOf(error)}`, { cause: error });
    }
  }
  return loaded;
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
  let manifest: unknown;
  try {
    manifest = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`${path} is not valid JSON: ${messageOf(error)}`, { cause: error });
  }
  if (!isRecord(manifest)) throw new ConfigError(`${path} must contain a JSON object.`);
  return manifest as PackageManifest;
}

function isMissing(error: unknown): boolean {
  return isRecord(error) && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

function packageEntryPath(manifest: PackageManifest, specifier: string, subpath: string): string {
  const fallback = manifest.module ?? manifest.main ?? "index.js";
  if (manifest.exports === undefined || manifest.exports === null) return subpath ? `./${subpath}` : fallback;
  const target = conditionTarget(exportEntry(manifest.exports, subpath ? `./${subpath}` : "."));
  if (target !== undefined) return target;
  if (subpath) throw new ConfigError(`Plugin ${specifier} is not exported by its package.`);
  return fallback;
}

function exportEntry(exports: unknown, request: string): unknown {
  if (!isRecord(exports) || !Object.keys(exports).some((key) => key.startsWith("."))) return request === "." ? exports : undefined;
  if (Object.hasOwn(exports, request)) return exports[request];
  let best: { readonly key: string; readonly match: string } | undefined;
  for (const key of Object.keys(exports)) {
    const match = patternMatch(key, request);
    if (match !== undefined && (!best || key.indexOf("*") > best.key.indexOf("*"))) best = { key, match };
  }
  return best ? substitute(exports[best.key], best.match) : undefined;
}

function patternMatch(pattern: string, request: string): string | undefined {
  const star = pattern.indexOf("*");
  if (star < 0 || pattern.includes("*", star + 1)) return undefined;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  if (request.length < prefix.length + suffix.length || !request.startsWith(prefix) || !request.endsWith(suffix)) return undefined;
  return request.slice(prefix.length, request.length - suffix.length);
}

function substitute(target: unknown, match: string): unknown {
  if (typeof target === "string") return target.replaceAll("*", match);
  if (Array.isArray(target)) return target.map((item) => substitute(item, match));
  if (isRecord(target)) return Object.fromEntries(Object.entries(target).map(([condition, value]) => [condition, substitute(value, match)]));
  return target;
}

function conditionTarget(target: unknown): string | undefined {
  if (typeof target === "string") return target;
  if (Array.isArray(target)) {
    for (const item of target) {
      const resolved = conditionTarget(item);
      if (resolved) return resolved;
    }
    return undefined;
  }
  if (!isRecord(target)) return undefined;
  for (const condition of ["node", "import", "default", "require"]) {
    const resolved = conditionTarget(target[condition]);
    if (resolved) return resolved;
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

function fileStem(specifier: string): string {
  const last = specifier.split(/[\\/]/).at(-1) ?? specifier;
  return last.slice(0, last.length - extname(last).length) || last;
}

function namespaceFromPackageName(name: string): string {
  const last = name.split("/").at(-1) ?? name;
  return last.replace(/^gherkin-refine-plugin-/, "").replace(/^gherkinlint-plugin-/, "").replace(/^eslint-plugin-/, "");
}
