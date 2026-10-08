# Compatibility corpus

This suite checks Gherkin source preservation against pinned public fixtures. It does not run upstream projects, install their dependencies, or claim compatibility with their step definitions.

## Run

After `npm ci`:

```sh
npm run compatibility
npm run compatibility:full
npm run compatibility:published
```

The first command builds the candidate and checks 12 committed fixtures without upstream downloads. PR CI runs it on every supported CI platform. The full command checks the candidate against 292 pinned upstream files. The published command installs the exact npm version in `corpus.json` into a temporary directory with lifecycle scripts disabled, then runs the full corpus. It does not build the candidate.

The manual **Compatibility corpus** workflow runs both full modes and uploads JSON reports. A changed published version must be reviewed explicitly in the manifest. Versions and fixture expectations never follow a floating upstream branch.

## Sources and attribution

| Repository | Selected paths | Files | License |
| --- | --- | ---: | --- |
| [cucumber/gherkin](https://github.com/cucumber/gherkin) | `testdata/good`, `testdata/bad` | 62 | MIT |
| [cucumber/cucumber-js](https://github.com/cucumber/cucumber-js) | `features` | 78 | MIT |
| [cucumber/cucumber-ruby](https://github.com/cucumber/cucumber-ruby) | `examples/i18n`, `features` | 152 | MIT |

`corpus.json` records full commit IDs, selected file paths, expected parse classification, and SHA-256 hashes for every source file and license. Each snapshot directory includes the license from its pinned revision, retaining upstream copyright notices. Snapshot bytes are unchanged. The manifest marks which files belong to the offline sample.

Full runs fetch only these feature files and licenses from pinned raw GitHub URLs. Missing sources, hash changes, unexpected parser classifications, and assertion failures fail the run. Fetches have 30-second deadlines with at most eight concurrent requests. Each linter call has a 10-second abort deadline; package installation has a two-minute timeout. The manual job has a 15-minute deadline. Upstream executable code is never run.

## Assertions

Each fixture is copied into a disposable directory. Read-only linting must preserve its SHA-256 hash. Valid fixtures must parse and must not produce parser diagnostics. The 12 intentionally invalid Gherkin fixtures must produce parser diagnostics and retain their bytes under fix mode. Other recommended-rule findings are reported, not assumed to be compatibility defects.

Valid fixtures run with only `no-trailing-whitespace` and `no-extra-blank-lines` enabled. Source differences must consist of trailing ASCII space/tab removal or removal of consecutive blank lines. Changed files must reparse. AST comparison ignores generated IDs and locations, then preserves keywords, names, steps, tags, ordering, tables, Examples values, and Doc String content and media types exactly.

The comparator permits one asymmetric exception: a changed description or comment text must equal the original with trailing ASCII spaces/tabs removed from each line. It preserves line endings, leading and internal whitespace, Unicode whitespace, and blank lines. Reports record strict AST mismatches and each permitted prose edit, including the field and before/after values. A second fix run must produce identical file bytes.

`test/compatibility.test.mjs` verifies that the assertions reject content changes, added whitespace, altered data values, and line-ending changes. The existing `test/fix-safety.test.ts` injects invalid plugin fixes on first and later passes and verifies that no files are written before validation completes. This does not claim transactional rollback for filesystem failures during the later write phase.

## Reports and limits

Every run writes `compatibility-report.json`, including artifact mode, tool, tested parser, and comparison parser versions, fixture classifications, recommended-rule findings, changed-file counts, permitted prose edits, and failures. Total elapsed time includes upstream downloads in full mode; each source's elapsed time measures its checks after downloading. Peak RSS comes from Node's `process.resourceUsage().maxRSS`, in KiB, for the harness process only, excluding npm child processes. These measurements are informational and have no timing or memory pass threshold.

The comparison parser is the version pinned by this project's lockfile. The tested package's own parsing behavior is checked through its API diagnostics. Files are checked individually, so this corpus does not exercise cross-file project rules. This suite is not an independent parser implementation or proof of arbitrary step-definition semantics.

All three initial sources are Cucumber-maintained reference or acceptance projects. They provide many syntax conventions, but do not establish independent application adoption. A later expansion should add unrelated application repositories and Python/Java conventions. See [results](RESULTS.md) for the measured first run.
