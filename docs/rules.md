# Rules

Recommended rules check correctness and use AST semantics. Size, naming, tag conventions, and whitespace preferences are opt-in.

| Rule | Default | Options | Behavior |
| --- | --- | --- | --- |
| `no-duplicate-tags` | error | none | Finds duplicate tags on a Feature, Rule, Scenario, or Examples block |
| `no-duplicate-feature-names` | error | none | Finds case-insensitive duplicate Feature names across linted files |
| `no-duplicate-scenario-names` | error | none | Finds case-insensitive duplicate Scenario names within one Feature or one Rule |
| `no-unused-outline-variables` | error | none | Finds declared Examples columns unused in steps or step arguments |
| `no-undefined-outline-variables` | error | none | Finds step placeholders without an Examples column |
| `scenario-size` | off | `{ maxSteps: 12 }` | Limits direct Scenario steps, not Background steps |
| `background-size` | off | `{ maxSteps: 5 }` | Limits Feature and Rule Background steps |
| `feature-size` | off | `{ maxScenarios: 20 }` | Limits Scenarios in a Feature, including Scenarios under Rules |
| `name-length` | off | `{ max: 80 }` | Limits Feature and Scenario names |
| `tag-pattern` | off | `{ pattern: "^@[a-z0-9][a-z0-9_-]*$" }` | Requires tag names to match a regular expression |
| `logical-keyword-order` | off | none | Keeps semantic Given, When, and Then stages in order |
| `no-trailing-whitespace` | off | none | Reports and safely removes trailing spaces and tabs |
| `no-extra-blank-lines` | off | none | Reports repeated empty lines and safely removes extras |
| `unused-disable-directive` | off | none | Reports stale suppression comments when reporting is enabled |

`And`, `But`, and `*` do not start a new logical stage. The order rule uses the parser's semantic keyword types, so localized step keywords follow the same behavior. A `Rule` is a separate scope for duplicate Scenario names and Rule-level Backgrounds remain part of the parsed document.

`scenario-size`, `background-size`, `feature-size`, `name-length`, `tag-pattern`, `logical-keyword-order`, and formatting rules are disabled by default because teams can reasonably choose different styles.

Use `gherkin-refine --list-rules --format json` for machine-readable metadata and `gherkin-refine --explain <rule-id>` for a local explanation.
