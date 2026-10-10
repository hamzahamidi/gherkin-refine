# Migration from gherkin-lint

Replace the `gherkin-lint` dependency with `gherkin-refine`. The package installs a `gherkin-lint` command, reads `.gherkin-lintrc` and `.gherkin-lintignore` from the working directory, and accepts the gherkin-lint flags below, so existing scripts keep working. A `.gherkin-lintrc` runs only the rules it lists. When it lists rules that gherkin-refine cannot fully check, each run prints one warning line on stderr.

To review those differences, or to move to a native configuration, convert the file. The historical `.gherkin-lintrc` file is JSON and may contain comments. Run:

```sh
gherkin-refine migrate .gherkin-lintrc --dry-run
gherkin-refine migrate .gherkin-lintrc
```

The migration writes `gherkin-refine.config.json` and does not replace an existing file unless `--force` is provided. Review every reported behavior difference before enabling the generated configuration.

The generated configuration sets `extends: []`. gherkin-lint runs only the rules a file lists, so the recommended preset stays off until you remove that line. Rules set to `off` in the legacy file are not reported as unsupported.

Keep `.gherkin-lintignore`. gherkin-refine reads it from the working directory on every run, as gherkin-lint does, and adds its non-empty lines to `ignores`.

| Legacy rule | New rule | Status |
| --- | --- | --- |
| `no-duplicate-tags` | `no-duplicate-tags` | Same intent |
| `no-dupe-feature-names` | `no-duplicate-feature-names` | Scope is the set of linted files |
| `no-dupe-scenario-names` | `no-duplicate-scenario-names` | The default `anywhere` maps to `{ scope: "anywhere" }`; `in-feature` maps to one Feature or Rule. Names compare case-insensitively |
| `no-unused-variables` | `no-unused-outline-variables` | Uses parsed step arguments and localized AST |
| `scenario-size` | `scenario-size`, `background-size` | Scenario and Background limits map separately. Without options, both use the gherkin-lint default of 15 |
| `name-length` | `name-length` | Same per-node limits for Feature, Rule, Scenario, and Step |
| `no-trailing-spaces` | `no-trailing-whitespace` | Same intent, with safe autofix |
| `no-multiple-empty-lines` | `no-extra-blank-lines` | Same intent, with safe autofix |
| `keywords-in-logical-order` | `logical-keyword-order` | Uses parser semantic step types, including localized dialects |
| `allowed-tags` | `allowed-tags` | Same `tags` and `patterns` options. Tags inside Rule blocks are also checked |
| `no-restricted-tags` | `no-restricted-tags` | Same `tags` and `patterns` options. Tags inside Rule blocks are also checked |
| `indentation`, `new-line-at-eof`, `file-name`, `use-and`, `one-space-between-tags`, `required-tags`, `no-restricted-patterns` | Same names | Same options and findings. Each one except `file-name` has a safe autofix |
| `no-unnamed-features`, `no-unnamed-scenarios`, `no-empty-file`, `no-files-without-scenarios`, `no-empty-background`, `no-background-only-scenario`, `no-scenario-outlines-without-examples`, `no-examples-in-scenarios`, `no-partially-commented-tag-lines`, `no-superfluous-tags` | Same names | Same findings. Except for `indentation`, rules that walk Scenarios also check the ones inside Rule blocks |
| `no-homogenous-tags` | `no-homogeneous-tags` | Spelling corrected; see the fixes below |
| `max-scenarios-per-file` | `feature-size` | Same count and options: `countOutlineExamples` defaults to `true` when migrated, `maxScenarios` to 10 |
| `only-one-when` | `only-one-when` | `And` after `When` no longer counts as a second `When` ([gherkin-lint#345](https://github.com/gherkin-lint/gherkin-lint/issues/345)) |
| Custom rules from `--rulesdir` | none | Reported as unsupported |

Three rules fix gherkin-lint bugs and can only report less than before: `no-homogeneous-tags` ignores a single Scenario or Examples block and reports one finding per tag ([#231](https://github.com/gherkin-lint/gherkin-lint/issues/231), [#257](https://github.com/gherkin-lint/gherkin-lint/issues/257), [#170](https://github.com/gherkin-lint/gherkin-lint/issues/170)), `no-background-only-scenario` ignores a Background without Scenarios ([#159](https://github.com/gherkin-lint/gherkin-lint/issues/159)), and `only-one-when` as above.

`migrate --strict` fails without writing a file when any rule cannot be fully migrated.

This is a migration aid, not a compatibility mode. Review output because the former and current tools have different parser and scope behavior.

## CLI flags

| gherkin-lint | gherkin-refine |
| --- | --- |
| `-c, --config` | `-c, --config`, including a path to a `.gherkin-lintrc` |
| `-f, --format` | `-f, --format`. `xunit` has no equivalent; `json`, `ndjson`, and `sarif` are available |
| `-i, --ignore` | `-i, --ignore`. The comma-separated patterns replace `.gherkin-lintignore` |
| `-r, --rulesdir` | `-r, --rulesdir`. A directory without `.js` files is accepted; custom rules must be ported to a [plugin](plugins.md) |
