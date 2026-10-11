import { lstat, realpath, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { glob } from "glob";
import { compareText } from "./ordering.js";

const DEFAULT_IGNORES = ["**/.git/**", "**/node_modules/**", "**/dist/**", "**/coverage/**"];
const GLOB_OPTIONS = { absolute: true, nodir: true, follow: false, dot: true, ignore: DEFAULT_IGNORES };

interface DiscoveredInput {
  readonly paths: readonly string[];
  readonly explicit: boolean;
}

export async function discoverFiles(inputs: readonly string[], cwd: string): Promise<{ paths: string[]; explicitFiles: ReadonlySet<string> }> {
  const files = new Set<string>();
  const explicitFiles = new Set<string>();
  for await (const input of inputs) {
    const { paths, explicit } = await discoverInput(input, cwd);
    for (const path of paths) {
      files.add(path);
      if (explicit) explicitFiles.add(path);
    }
  }
  return { paths: [...files].sort(compareText), explicitFiles };
}

async function discoverInput(input: string, cwd: string): Promise<DiscoveredInput> {
  const existing = await discoverExistingPath(resolve(cwd, input));
  return existing ?? { paths: await expandGlob(input, cwd), explicit: false };
}

async function discoverExistingPath(absoluteInput: string): Promise<DiscoveredInput | undefined> {
  try {
    const inputStat = await lstat(absoluteInput);
    const isLink = inputStat.isSymbolicLink();
    const targetStat = isLink ? await stat(absoluteInput) : inputStat;
    if (targetStat.isFile()) return { paths: [absoluteInput], explicit: true };
    if (targetStat.isDirectory()) return { paths: await scanDirectory(absoluteInput, isLink), explicit: false };
  } catch (error) {
    if (!isMissingPath(error)) throw error;
  }
  return undefined;
}

async function scanDirectory(directory: string, isLink: boolean): Promise<string[]> {
  const scanRoot = isLink ? await realpath(directory) : directory;
  const found = await glob("**/*.feature", { ...GLOB_OPTIONS, cwd: scanRoot });
  return isLink ? found.map((path) => resolve(directory, relative(scanRoot, path))) : found;
}

async function expandGlob(input: string, cwd: string): Promise<string[]> {
  if (!/[*?{}[\]]/.test(input)) throw new Error(`Input path does not exist: ${input}`);
  const found = await glob(input.replaceAll("\\", "/"), { ...GLOB_OPTIONS, cwd });
  if (found.length === 0) throw new Error(`Glob pattern did not match any files: ${input}`);
  return found;
}

function isMissingPath(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
