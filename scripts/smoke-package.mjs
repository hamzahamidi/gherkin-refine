import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), "gherkin-refine-smoke-"));
const fixture = join(temporary, "consumer");

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with ${result.status}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

function npm(args, cwd) {
  const npmCli = process.env.npm_execpath;
  if (npmCli) return run(process.execPath, [npmCli, ...args], cwd);
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(command, args, { cwd, encoding: "utf8", shell: process.platform === "win32", maxBuffer: 10 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`npm ${args.join(" ")} failed with ${result.status}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

try {
  await mkdir(fixture, { recursive: true });
  run(process.execPath, ["scripts/clean.mjs"], root);
  run(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"], root);
  const packed = npm(["pack", "--ignore-scripts", "--json", "--pack-destination", temporary], root);
  const packResult = JSON.parse(packed);
  const packInfo = Array.isArray(packResult) ? packResult[0] : packResult?.filename ? packResult : Object.values(packResult)[0];
  assert.equal(typeof packInfo?.filename, "string", "npm pack must report the generated tarball");
  const tarball = join(temporary, packInfo.filename);
  npm(["install", "--prefix", fixture, "--no-save", "--ignore-scripts", "--no-audit", "--no-fund", tarball], root);
  const packageRoot = join(fixture, "node_modules", "gherkin-refine");
  const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));

  const feature = "Feature: Installed package\n  @smoke @smoke\n  Scenario: consumer import\n";
  const featurePath = join(fixture, "features", "smoke.feature");
  await mkdir(join(fixture, "features"), { recursive: true });
  await writeFile(featurePath, feature);
  const cliPath = join(fixture, "node_modules", ".bin", process.platform === "win32" ? "gherkin-refine.cmd" : "gherkin-refine");
  const cli = spawnSync(cliPath, ["features/smoke.feature", "--format", "json"], {
    cwd: fixture,
    encoding: "utf8",
    shell: process.platform === "win32"
  });
  assert.equal(cli.status, 1, `CLI returned ${cli.status}; stdout: ${cli.stdout}; stderr: ${cli.stderr}`);
  assert.equal(cli.stderr, "");
  assert.equal(JSON.parse(cli.stdout).results[0].diagnostics[0].ruleId, "no-duplicate-tags");
  const legacyCliPath = join(fixture, "node_modules", ".bin", process.platform === "win32" ? "gherkinlint.cmd" : "gherkinlint");
  for (const executable of [cliPath, legacyCliPath]) {
    const version = spawnSync(executable, ["--version"], {
      cwd: fixture,
      encoding: "utf8",
      shell: process.platform === "win32"
    });
    assert.equal(version.status, 0, `Version command returned ${version.status}; stderr: ${version.stderr}`);
    assert.equal(version.stderr, "");
    assert.equal(version.stdout.trim(), manifest.version);
  }
  const legacyCli = spawnSync(legacyCliPath, ["features/smoke.feature", "--format", "json"], {
    cwd: fixture,
    encoding: "utf8",
    shell: process.platform === "win32"
  });
  assert.equal(legacyCli.status, 1, `Compatibility CLI returned ${legacyCli.status}; stdout: ${legacyCli.stdout}; stderr: ${legacyCli.stderr}`);

  const apiScript = join(fixture, "api-smoke.mjs");
  await writeFile(apiScript, `import assert from "node:assert/strict";
import { lintText } from "gherkin-refine";
const result = await lintText(${JSON.stringify(feature)}, { filePath: "features/smoke.feature" });
assert.equal(result.summary.errors, 1);
assert.equal(result.tool.name, "gherkin-refine");
`);
  run(process.execPath, [apiScript], fixture);
  await access(join(packageRoot, "dist", "index.d.ts"));
  await access(join(fixture, "node_modules", ".bin", process.platform === "win32" ? "gherkinlint.cmd" : "gherkinlint"));
  const packagedFiles = packInfo.files.map((item) => item.path);
  assert(packagedFiles.includes("dist/index.js"));
  assert(packagedFiles.includes("dist/index.d.ts"));
  assert(!packagedFiles.some((path) => path.startsWith("src/")));
  assert.equal(manifest.type, "module");
  assert.equal(manifest.bin["gherkin-refine"], "./dist/cli.js");
  assert.equal(manifest.bin.gherkinlint, "./dist/cli.js");
  assert.equal(manifest.bin["gherkin-lint"], "./dist/cli.js");
  process.stdout.write("package smoke passed\n");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
