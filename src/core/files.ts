import { lstat, realpath, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { glob } from "glob";

const DEFAULT_IGNORES = ["**/.git/**", "**/node_modules/**", "**/dist/**", "**/coverage/**"];

export async function discoverFiles(inputs: readonly string[], cwd: string): Promise<{ paths: string[]; explicitFiles: ReadonlySet<string> }> {
  const files = new Set<string>();
  const explicitFiles = new Set<string>();
  for (const input of inputs) {
    const absoluteInput = resolve(cwd, input);
    try {
      const inputStat = await lstat(absoluteInput);
      const targetStat = inputStat.isSymbolicLink() ? await stat(absoluteInput) : inputStat;
      if (targetStat.isFile()) {
        files.add(absoluteInput);
        explicitFiles.add(absoluteInput);
        continue;
      }
      if (targetStat.isDirectory()) {
        const scanRoot = inputStat.isSymbolicLink() ? await realpath(absoluteInput) : absoluteInput;
        const found = await glob("**/*.feature", {
          cwd: scanRoot,
          absolute: true,
          nodir: true,
          follow: false,
          dot: true,
          ignore: DEFAULT_IGNORES
        });
        for (const path of found) files.add(inputStat.isSymbolicLink() ? resolve(absoluteInput, relative(scanRoot, path)) : path);
        continue;
      }
    } catch (error) {
      if (!isMissingPath(error)) throw error;
    }

    if (!/[*?{}[\]]/.test(input)) throw new Error(`Input path does not exist: ${input}`);
    const pattern = input.replaceAll("\\", "/");
    const found = await glob(pattern, {
      cwd,
      absolute: true,
      nodir: true,
      follow: false,
      dot: true,
      ignore: DEFAULT_IGNORES
    });
    if (found.length === 0) throw new Error(`Glob pattern did not match any files: ${input}`);
    for (const path of found) files.add(path);
  }
  return { paths: [...files].sort(compareText), explicitFiles };
}

function isMissingPath(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
