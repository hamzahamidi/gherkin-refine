# Migration from gherkin-lint

The historical `.gherkin-lintrc` file is JSON and may contain comments. Run:

```sh
gherkin-refine migrate .gherkin-lintrc --dry-run
gherkin-refine migrate .gherkin-lintrc
```

The migration writes `gherkin-refine.config.json` and does not replace an existing file unless `--force` is provided. Review every reported behavior difference before enabling the generated configuration.

| Legacy rule | New rule | Status |
| --- | --- | --- |
| `no-duplicate-tags` | `no-duplicate-tags` | Same intent |
| `no-dupe-feature-names` | `no-duplicate-feature-names` | Scope is the set of linted files |
| `no-dupe-scenario-names` | `no-duplicate-scenario-names` | New scope is one Feature or Rule, not all files |
| `no-unused-variables` | `no-unused-outline-variables` | Uses parsed step arguments and localized AST |
| `scenario-size` | `scenario-size` | Scenario step limit maps; Background limits are reported as unsupported |
| `name-length` | `name-length` | One shared limit maps; distinct Feature and Scenario limits need manual adjustment |
| `no-trailing-spaces` | `no-trailing-whitespace` | Same intent, with safe autofix |
| `no-multiple-empty-lines` | `no-extra-blank-lines` | Same intent, with safe autofix |
| `keywords-in-logical-order` | `logical-keyword-order` | Uses parser semantic step types, including localized dialects |
| Other rules | none | Reported as unsupported |

This is a migration aid, not a compatibility mode. Review output because the former and current tools have different parser and scope behavior.
