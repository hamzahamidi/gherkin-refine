# Rules

Recommended rules check correctness and use AST semantics. Size, naming, tag conventions, and whitespace preferences are opt-in.

| Rule | Default | Options | Behavior |
| --- | --- | --- | --- |
| [`no-duplicate-tags`](rules/no-duplicate-tags.md) | error | none | Finds duplicate tags on a Feature, Rule, Scenario, or Examples block |
| [`no-duplicate-feature-names`](rules/no-duplicate-feature-names.md) | error | none | Finds case-insensitive duplicate Feature names across linted files |
| [`no-duplicate-scenario-names`](rules/no-duplicate-scenario-names.md) | error | `{}` | Finds case-insensitive duplicate Scenario names within one Feature or one Rule. `{ scope: "anywhere" }` compares across all linted files |
| [`no-unused-outline-variables`](rules/no-unused-outline-variables.md) | error | none | Finds declared Examples columns unused in steps or step arguments |
| [`no-undefined-outline-variables`](rules/no-undefined-outline-variables.md) | error | none | Finds step placeholders without an Examples column |
| [`scenario-size`](rules/scenario-size.md) | off | `{ maxSteps: 12 }` | Limits direct Scenario steps, not Background steps |
| [`background-size`](rules/background-size.md) | off | `{ maxSteps: 5 }` | Limits Feature and Rule Background steps |
| [`feature-size`](rules/feature-size.md) | off | `{ maxScenarios: 20 }` | Limits Scenarios in a Feature, including Scenarios under Rules. `countOutlineExamples: true` counts each Examples row of an outline |
| [`name-length`](rules/name-length.md) | off | `{ max: 80 }` | Limits Feature and Scenario names. Per-node limits `{ Feature, Rule, Scenario, Step }` also check Rule names and step text; each missing key defaults to 70 |
| [`tag-pattern`](rules/tag-pattern.md) | off | `{ pattern: "^@[a-z0-9][a-z0-9_-]*$" }` | Requires tag names to match a regular expression |
| [`allowed-tags`](rules/allowed-tags.md) | off | `{ tags: [], patterns: [] }` | Reports tags that are not listed in `tags` and match no regular expression in `patterns` |
| [`no-restricted-tags`](rules/no-restricted-tags.md) | off | `{ tags: [], patterns: [] }` | Reports tags listed in `tags` or matching a regular expression in `patterns` |
| [`no-unnamed-features`](rules/no-unnamed-features.md) | off | none | Requires a Feature with a name; an empty file also counts as unnamed |
| [`no-unnamed-scenarios`](rules/no-unnamed-scenarios.md) | off | none | Requires every Scenario to have a name |
| [`no-scenario-outlines-without-examples`](rules/no-scenario-outlines-without-examples.md) | off | none | Finds Scenario Outlines with no Examples rows, which never run |
| [`no-examples-in-scenarios`](rules/no-examples-in-scenarios.md) | off | none | Finds Examples under the `Scenario` keyword instead of `Scenario Outline` |
| [`no-empty-file`](rules/no-empty-file.md) | off | none | Finds files without a Feature |
| [`no-files-without-scenarios`](rules/no-files-without-scenarios.md) | off | none | Finds Features without any Scenario, including Scenarios under Rules |
| [`no-empty-background`](rules/no-empty-background.md) | off | none | Finds Backgrounds without steps |
| [`no-background-only-scenario`](rules/no-background-only-scenario.md) | off | none | Finds a Background whose Feature or Rule has exactly one Scenario |
| [`no-partially-commented-tag-lines`](rules/no-partially-commented-tag-lines.md) | off | none | Finds tag lines that end in a comment, which hides the tags after `#`, and tags containing `#` |
| [`one-space-between-tags`](rules/one-space-between-tags.md) | off | none | Reports and safely collapses repeated spaces between tags on one line |
| [`no-superfluous-tags`](rules/no-superfluous-tags.md) | off | none | Finds tags repeated from the enclosing Feature, Rule, or Scenario |
| [`no-homogeneous-tags`](rules/no-homogeneous-tags.md) | off | none | Finds each tag present on every one of two or more Scenarios of a Feature or Rule, or of two or more Examples blocks |
| [`use-and`](rules/use-and.md) | off | none | Reports and safely replaces a step keyword that repeats the previous one with `And`. `*` counts as `And` |
| [`indentation`](rules/indentation.md) | off | `{}` | Reports and safely fixes indentation. Defaults: `Feature`, `Background`, `Rule`, `Scenario`, `Examples` 0, `Step` and `example` 2; `given`, `when`, `then`, `and`, `but`, `feature tag`, and `scenario tag` override per line type. Content inside a Rule is checked only when `rule content` sets its extra indentation |
| [`new-line-at-eof`](rules/new-line-at-eof.md) | off | `"yes"` | Requires (`"yes"`) or forbids (`"no"`) a final line break, with a safe fix |
| [`required-tags`](rules/required-tags.md) | off | `{ tags: [], ignoreUntagged: true }` | Requires every tagged Scenario to have a tag matching each regular expression in `tags`. `ignoreUntagged: false` also checks untagged Scenarios |
| [`no-restricted-patterns`](rules/no-restricted-patterns.md) | off | `{}` | Finds case-insensitive regular expressions in names, descriptions, and steps, keyed by `Global`, `Feature`, `Rule`, `Background`, `Scenario`, and `ScenarioOutline` |
| [`only-one-when`](rules/only-one-when.md) | off | none | Allows at most one explicit `When` step per Scenario. `And` after `When` does not count |
| [`file-name`](rules/file-name.md) | off | `{ style: "PascalCase" }` | Requires file names in `PascalCase`, `Title Case`, `camelCase`, `kebab-case`, or `snake_case`, split into words as lodash does |
| [`logical-keyword-order`](rules/logical-keyword-order.md) | off | none | Keeps semantic Given, When, and Then stages in order |
| [`no-trailing-whitespace`](rules/no-trailing-whitespace.md) | off | none | Reports and safely removes trailing spaces and tabs |
| [`no-extra-blank-lines`](rules/no-extra-blank-lines.md) | off | none | Reports repeated empty lines and safely removes extras |
| [`unused-disable-directive`](rules/unused-disable-directive.md) | off | none | Reports stale suppression comments when reporting is enabled |

`And`, `But`, and `*` do not start a new logical stage. The order rule uses the parser's semantic keyword types, so localized step keywords follow the same behavior. A `Rule` is a separate scope for duplicate Scenario names and Rule-level Backgrounds remain part of the parsed document.

`scenario-size`, `background-size`, `feature-size`, `name-length`, `tag-pattern`, `allowed-tags`, `no-restricted-tags`, `logical-keyword-order`, formatting rules, and the rules carried over from gherkin-lint are disabled by default because teams can reasonably choose different styles.

Use `gherkin-refine --list-rules --format json` for machine-readable metadata and `gherkin-refine --explain <rule-id>` for a local explanation.
