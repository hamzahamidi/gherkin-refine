import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { lintFiles } from "../dist/index.js";

const temporary = await mkdtemp(join(tmpdir(), "gherkin-refine-benchmark-"));
const directory = join(temporary, "features");
await mkdir(directory);

try {
  const paths = [];
  for (let index = 0; index < 1000; index += 1) {
    const path = join(directory, `feature-${String(index).padStart(4, "0")}.feature`);
    paths.push(path);
    await writeFile(path, `Feature: Feature ${index}\n  Scenario: Login ${index}\n    Given a user exists\n    When the user logs in\n    Then the dashboard is visible\n`);
  }
  const rows = [];
  for (const count of [1, 100, 1000]) {
    globalThis.gc?.();
    let peakRss = process.memoryUsage().rss;
    const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 5);
    const started = performance.now();
    const result = await lintFiles(paths.slice(0, count), { cwd: temporary, concurrency: 8 });
    const elapsedMs = performance.now() - started;
    clearInterval(sampler);
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
    rows.push({
      files: result.summary.files,
      elapsedMs: Number(elapsedMs.toFixed(1)),
      diagnostics: result.summary.errors + result.summary.warnings,
      peakRssMiB: Number((peakRss / 1024 / 1024).toFixed(1))
    });
  }
  process.stdout.write(`${JSON.stringify({ node: process.version, concurrency: 8, results: rows }, null, 2)}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
