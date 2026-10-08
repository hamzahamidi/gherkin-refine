import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import { assertWhitespaceEdits, compareAst, normalizeAst } from './lib/compatibility-assertions.mjs';
import { AstBuilder, GherkinClassicTokenMatcher, Parser } from '@cucumber/gherkin';
import { IdGenerator } from '@cucumber/messages';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = new Set(process.argv.slice(2));
for (const arg of args) assert(['--full', '--published'].includes(arg), `Unknown argument: ${arg}`);
const manifest = JSON.parse(await readFile(join(root, 'compatibility/corpus.json'), 'utf8'));
const temporary = await mkdtemp(join(tmpdir(), 'gherkin-refine-compatibility-'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const report = { schemaVersion: 1, mode: args.has('--full') ? 'full' : 'sample', artifact: args.has('--published') ? 'published' : 'candidate', toolVersion: null, parserVersion: null, sources: [], failures: [] };
const run = (command, commandArgs, cwd = temporary) => execFileSync(command, commandArgs, { cwd, timeout: 120_000, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const parse = (source) => new Parser(new AstBuilder(IdGenerator.incrementing()), new GherkinClassicTokenMatcher()).parse(source);

try {
  let packageRoot = root;
  if (args.has('--published')) {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    run(npm, ['install', '--prefix', temporary, '--ignore-scripts', '--no-save', '--no-audit', '--no-fund', `gherkin-refine@${manifest.publishedVersion}`]);
    packageRoot = join(temporary, 'node_modules/gherkin-refine');
  }
  const { lintFiles } = await import(pathToFileURL(join(packageRoot, 'dist/index.js')).href);
  report.toolVersion = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')).version;
  const require = createRequire(import.meta.url);
  report.parserVersion = JSON.parse(await readFile(require.resolve('@cucumber/gherkin/package.json'), 'utf8')).version;
  const started = performance.now();
  for (const source of manifest.sources) {
    assert.match(source.commit, /^[a-f0-9]{40}$/);
    assert.match(source.repository, /^[\w-]+\/[\w.-]+$/);
    const downloaded = new Map();
    if (args.has('--full')) {
      const paths = [source.licensePath, ...source.fixtures.map((fixture) => fixture.path)];
      for (let offset = 0; offset < paths.length; offset += 8) {
        await Promise.all(paths.slice(offset, offset + 8).map(async (path) => {
          const url = `https://raw.githubusercontent.com/${source.repository}/${source.commit}/${path}`;
          const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
          assert(response.ok, `${url}: HTTP ${response.status}`);
          const bytes = Buffer.from(await response.arrayBuffer());
          assert(bytes.length < 2 * 1024 * 1024, `${path}: input exceeds 2 MiB`);
          downloaded.set(path, bytes);
        }));
      }
    }
    const load = (path) => args.has('--full') ? Promise.resolve(downloaded.get(path)) : readFile(join(root, 'compatibility/fixtures', source.name, path));
    assert.equal(sha256(await load(source.licensePath)), source.licenseSha256, `${source.name}: license hash`);
    const fixtures = source.fixtures.filter((fixture) => args.has('--full') || fixture.sample);
    assert(fixtures.length > 0, `${source.name}: empty corpus`);
    const sourceReport = { repository: source.repository, commit: source.commit, files: [], elapsedMs: 0 };
    report.sources.push(sourceReport);
    const sourceStarted = performance.now();
    for (const fixture of fixtures) {
      const label = `${source.name}/${fixture.path}`;
      const fileReport = { path: fixture.path, expected: fixture.expected, changed: false, strictAstMismatch: false, permittedProseEdits: [], diagnostics: {}, status: 'passed' };
      sourceReport.files.push(fileReport);
      try {
        const original = await load(fixture.path);
        assert.equal(sha256(original), fixture.sha256, `${label}: source hash`);
        const sourceText = original.toString('utf8');
        let ast;
        let parseError;
        try { ast = parse(sourceText); } catch (error) { parseError = error; }
        if (fixture.expected === 'invalid') assert(parseError, `${label}: invalid input unexpectedly parses`);
        else assert(!parseError, `${label}: valid input fails parser: ${parseError?.message}`);
        const copy = join(temporary, 'copies', source.name, fixture.path);
        await mkdir(dirname(copy), { recursive: true });
        await writeFile(copy, original);
        const options = { signal: AbortSignal.timeout(10_000), cwd: temporary, config: { extends: ['recommended'] } };
        const readonly = await lintFiles([copy], options);
        assert.equal(readonly.results.length, 1, `${label}: result count`);
        fileReport.findings = readonly.results[0].diagnostics.map(({ ruleId, severity, start, message }) => ({ ruleId, severity, start, message }));
        for (const diagnostic of readonly.results[0].diagnostics) fileReport.diagnostics[diagnostic.ruleId] = (fileReport.diagnostics[diagnostic.ruleId] ?? 0) + 1;
        assert.equal(Boolean(fileReport.diagnostics['parsing-error']), fixture.expected === 'invalid', `${label}: parser diagnostic classification`);
        assert.equal(sha256(await readFile(copy)), fixture.sha256, `${label}: read-only bytes`);
        const fixOptions = { signal: AbortSignal.timeout(10_000), cwd: temporary, config: { extends: [], rules: { 'no-trailing-whitespace': 'error', 'no-extra-blank-lines': 'error' } }, fix: true };
        const first = await lintFiles([copy], fixOptions);
        const fixed = await readFile(copy);
        if (fixture.expected === 'invalid') {
          assert.equal(sha256(fixed), fixture.sha256, `${label}: invalid input bytes`);
          assert(first.results[0].diagnostics.some((item) => item.ruleId === 'parsing-error'));
          continue;
        }
        fileReport.changed = !fixed.equals(original);
        if (fileReport.changed) {
          assertWhitespaceEdits(sourceText, fixed.toString('utf8'));
          const before = normalizeAst(ast);
          const after = normalizeAst(parse(fixed.toString('utf8')));
          fileReport.strictAstMismatch = !isDeepStrictEqual(before, after);
          fileReport.permittedProseEdits = compareAst(before, after);
        }
        assert.equal(first.summary.errors, 0, `${label}: whitespace findings after fixes`);
        await lintFiles([copy], fixOptions);
        assert.deepEqual(await readFile(copy), fixed, `${label}: idempotence`);
      } catch (error) {
        fileReport.status = 'failed';
        report.failures.push({ fixture: label, message: error.message });
      }
    }
    sourceReport.elapsedMs = Math.round(performance.now() - sourceStarted);
  }
  report.elapsedMs = Math.round(performance.now() - started);
  report.peakRssKiB = process.resourceUsage().maxRSS;
} catch (error) {
  report.failures.push({ fixture: 'setup', message: error.message });
  process.exitCode = 1;
} finally {
  await writeFile(join(root, 'compatibility-report.json'), JSON.stringify(report, null, 2) + '\n');
  await rm(temporary, { recursive: true, force: true });
}
console.log(JSON.stringify({ toolVersion: report.toolVersion, mode: report.mode, artifact: report.artifact, files: report.sources.reduce((total, source) => total + source.files.length, 0), changed: report.sources.reduce((total, source) => total + source.files.filter((file) => file.changed).length, 0), failures: report.failures.length, elapsedMs: report.elapsedMs, peakRssKiB: report.peakRssKiB }));
if (report.failures.length) {
  for (const failure of report.failures) console.error(`${failure.fixture}: ${failure.message}`);
  process.exitCode = 1;
}
