import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { PluginModule } from "../types.js";
import { ConfigError, isRecord, messageOf } from "./errors.js";

export async function loadPlugins(cwd: string, specifiers: readonly string[]) {
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
