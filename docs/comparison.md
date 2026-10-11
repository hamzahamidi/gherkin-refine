# Gherkin Refine and gherkin-lint

This page compares [gherkin-lint](https://github.com/gherkin-lint/gherkin-lint) 4.2.4 with Gherkin Refine 1.3.2. The [migration guide](migration.md) maps each gherkin-lint rule and CLI flag.

## Compatibility summary

Gherkin Refine replaces the gherkin-lint command. It does not reproduce every gherkin-lint finding.

- Stays compatible: the `gherkin-lint` command, `.gherkin-lintrc`, `.gherkin-lintignore`, the `-c`, `-f` and `-i` flags, and all 31 built-in gherkin-lint rules.
- Changes: some findings, because of the newer parser, Scenarios inside `Rule` blocks, and three fixed gherkin-lint bugs. See [behavior that changes](#behavior-that-changes).
- Not supported: `xunit` output, and rules loaded with `-r` or `--rulesdir`. The flag is accepted, but its rules need porting to a [plugin](plugins.md).

## Should you switch

Switch if the project runs Node.js 22.18 or later and you want any of: a maintained Cucumber parser, `warn` severity, inline suppression, safe autofix, or SARIF output.

Stay on gherkin-lint for now if the project runs an older Node.js, CI reads `xunit` reports, custom `--rulesdir` rules are not worth porting yet, or something downstream depends on the exact gherkin-lint findings.

gherkin-lint has years of production use. Gherkin Refine is newer and independently maintained, and its parity tests reduce migration risk but do not replace that track record.

## Feature comparison

| | gherkin-lint 4.2.4 | Gherkin Refine 1.3.2 |
| --- | --- | --- |
| Published | December 20, 2023 | October 10, 2026 |
| Node.js | 10 or later | 22.18 or later |
| Module format | CommonJS | ESM with TypeScript types. The CLI runs from any project |
| License | ISC | MIT |
| Gherkin parser | `gherkin` 9.0.0, deprecated in favor of `@cucumber/gherkin` | `@cucumber/gherkin` 42 |
| Built-in rules | 31 | 35: the 31 gherkin-lint rules as 33, because `no-unused-variables` and `scenario-size` each split in two, plus `tag-pattern` and `unused-disable-directive` |
| Scenarios inside `Rule` blocks | In a test of 13 rules, 2 reported violations inside a `Rule`, listed below the table | Checked by every rule that walks Scenarios, except `indentation` |
| Rules on without a configuration file | None of the configurable rules | 5 recommended rules. A `.gherkin-lintrc` runs only the rules it lists |
| Severity | On or off. Every finding is an error | `off`, `warn` or `error`, plus `--max-warnings` |
| Configuration | `.gherkin-lintrc`, JSON with comments | `gherkin-refine.config.js`, `.mjs`, `.ts` or `.json` with presets and per-file overrides. Also reads `.gherkin-lintrc` |
| Ignore patterns | `.gherkin-lintignore`, or `--ignore` in its place | The same, added to `ignores` from the configuration |
| Inline suppression | None | `gherkin-refine-disable` comments, with a report of unused ones |
| Autofix | None | 6 opt-in whitespace and step keyword rules. `--fix-dry-run` previews; `--fix` writes only when the result still parses |
| Output formats | `stylish`, `json`, `xunit` | `stylish`, `compact`, `json`, `ndjson`, `sarif` |
| Exit codes | `0` clean. `1` for findings and for invalid configuration or input | `0` clean. `1` for errors, Gherkin syntax errors or too many warnings. `2` for invalid usage, configuration or plugins |
| Custom rules | JavaScript files loaded with `--rulesdir` | [Plugins](plugins.md). `--rulesdir` rules need porting |
| Programmatic API | None documented. The package entry point is the CLI | `lintText` and `lintFiles` |
| Machine-readable docs | README | [`llms.txt`](https://hamidihamza.com/gherkin-refine/llms.txt), [`llms-full.txt`](https://hamidihamza.com/gherkin-refine/llms-full.txt), `--list-rules --format json` and a JSON result schema |

The `Rule` block test places the same violations at the top level and inside a `Rule` block, and runs gherkin-lint with `allowed-tags`, `keywords-in-logical-order`, `name-length`, `no-duplicate-tags`, `no-examples-in-scenarios`, `no-restricted-tags`, `no-scenario-outlines-without-examples`, `no-unnamed-scenarios`, `no-unused-variables`, `only-one-when`, `required-tags`, `scenario-size` and `use-and`. Only `keywords-in-logical-order` and `only-one-when` reported inside the `Rule`. Gherkin Refine reported all 13 in both places.

## Behavior that changes

Three rules report less than gherkin-lint because they fix gherkin-lint bugs: `no-homogeneous-tags`, `no-background-only-scenario` and `only-one-when`. Rules that check Scenarios inside `Rule` blocks can report more. The [migration guide](migration.md) lists each difference with its gherkin-lint issue.

`test/gherkin-lint-parity.test.ts` runs gherkin-lint 4.2.4 and Gherkin Refine on shared fixtures in CI. 29 of its 36 cases compare each finding by file and line. Duplicate Feature names compare the text of the reported line, because gherkin-lint picks which copy to report by file read order. The other 6 compare finding counts, affected files, or a subset. It is regression evidence, not a guarantee of identical findings on every input.

## Check before switching

1. Run gherkin-lint and save its output and exit code.
2. Replace the dependency and keep `.gherkin-lintrc` and `.gherkin-lintignore`.
3. Run `gherkin-lint` again, now provided by Gherkin Refine, on the same files and compare.
4. Check anything that reads the output, and port `--rulesdir` rules.
5. Only then run `gherkin-refine migrate` and decide whether to turn on the recommended preset.
