# Changelog

## 1.3.0 (2026-10-10)

Supports every gherkin-lint 4.2.4 rule. Adds 18 rules under their gherkin-lint names: `indentation`, `new-line-at-eof`, `file-name`, `use-and`, `one-space-between-tags`, `no-unnamed-features`, `no-unnamed-scenarios`, `no-empty-file`, `no-files-without-scenarios`, `no-empty-background`, `no-background-only-scenario`, `no-scenario-outlines-without-examples`, `no-examples-in-scenarios`, `no-partially-commented-tag-lines`, `no-superfluous-tags`, `required-tags`, `no-restricted-patterns`, and `only-one-when`. Adds `no-homogeneous-tags`, which `migrate` maps from gherkin-lint's `no-homogenous-tags`, and a `countOutlineExamples` option on `feature-size`, which covers `max-scenarios-per-file`. The four formatting rules have safe autofixes. `name-length` accepts per-node limits, `no-duplicate-scenario-names` accepts `{ scope: "anywhere" }`, `indentation` can check content inside Rules, and `migrate --strict` fails on a lossy migration. Fixes gherkin-lint issues #159, #170, #231, #257, and #345.

## 1.2.0 (2026-10-10)

Makes gherkin-refine a drop-in replacement for gherkin-lint: installs a `gherkin-lint` command, reads `.gherkin-lintrc` from the working directory, accepts `-f`, `-i` and `-r`, and warns once per run about legacy rules it cannot fully check.

## 1.1.0 (2026-10-09)

Adds the `allowed-tags` and `no-restricted-tags` rules and reads `.gherkin-lintignore` from the working directory. Brings `migrate` output closer to gherkin-lint results: the generated configuration disables the recommended preset, maps Background limits to `background-size`, and uses gherkin-lint defaults for size limits.

## 1.0.6 (2026-10-08)

Allows selective suppression directives to reenable a rule after a blanket disable.

## 1.0.5 (2026-10-08)

Rejects autofix results that produce invalid Gherkin before any file is written.

## 1.0.4 (2026-10-08)

Keeps whitespace checks active after Doc Strings with delimiter suffixes.

## 1.0.3 (2026-10-08)

Updates package links to the renamed GitHub repository and documents a GitHub Actions quickstart.

## 1.0.2 (2026-10-08)

Uses package metadata as the source of truth for CLI version output.

## 1.0.1 (2026-10-08)

Adds package discovery keywords, npm funding metadata, and CI coverage reporting.

## 1.0.0 (2026-10-08)

Initial stable release of the ESM Gherkin linter, CLI, programmatic API, rule engine, machine output, migration command, and safe local fixes.
