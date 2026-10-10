# Migration from gherkin-lint

The historical `.gherkin-lintrc` file is JSON and may contain comments. Run:

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
| `no-dupe-scenario-names` | `no-duplicate-scenario-names` | New scope is one Feature or Rule, not all files |
| `no-unused-variables` | `no-unused-outline-variables` | Uses parsed step arguments and localized AST |
| `scenario-size` | `scenario-size`, `background-size` | Scenario and Background limits map separately. Without options, both use the gherkin-lint default of 15 |
| `name-length` | `name-length` | One limit covers Feature and Scenario names, so unequal limits use the higher one. Step text limits are reported as unsupported |
| `no-trailing-spaces` | `no-trailing-whitespace` | Same intent, with safe autofix |
| `no-multiple-empty-lines` | `no-extra-blank-lines` | Same intent, with safe autofix |
| `keywords-in-logical-order` | `logical-keyword-order` | Uses parser semantic step types, including localized dialects |
| `allowed-tags` | `allowed-tags` | Same `tags` and `patterns` options. Tags inside Rule blocks are also checked |
| `no-restricted-tags` | `no-restricted-tags` | Same `tags` and `patterns` options. Tags inside Rule blocks are also checked |
| Other rules | none | Reported as unsupported |

This is a migration aid, not a compatibility mode. Review output because the former and current tools have different parser and scope behavior.

## CLI flags

| gherkin-lint | gherkin-refine |
| --- | --- |
| `-c, --config` | `-c, --config` |
| `-f, --format` | `--format`. `xunit` has no equivalent; `json`, `ndjson`, and `sarif` are available |
| `-i, --ignore` | `ignores` in the configuration, or `.gherkin-lintignore` |
| `-r, --rulesdir` | `plugins` in the configuration. See [plugins](plugins.md) |

A `--rulesdir` that points at feature files loads no rules in gherkin-lint, so drop it.
