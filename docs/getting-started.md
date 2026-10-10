# Getting started

Gherkin Refine needs Node.js 22.18 or later.

## Install and lint

```sh
npm install --save-dev gherkin-refine
npx gherkin-refine .
```

The CLI finds `*.feature` files and skips `.git`, `node_modules`, `dist`, and `coverage`. Without a configuration file it runs the recommended rules: duplicate tags, duplicate Feature and Scenario names, and unused or undeclared Scenario Outline variables.

Exit code 0 means no errors, 1 means lint errors or too many warnings, and 2 means a configuration or usage error.

## Coming from gherkin-lint

Replace the `gherkin-lint` dependency with `gherkin-refine`. The package installs a `gherkin-lint` command and reads `.gherkin-lintrc` and `.gherkin-lintignore`, so scripts and configuration keep working. See [Migrate from gherkin-lint](migration.md).

## Configure

Create `gherkin-refine.config.json`, or a `.js`, `.mjs`, or `.ts` variant:

```json
{
  "extends": ["recommended"],
  "rules": {
    "scenario-size": ["warn", { "maxSteps": 12 }],
    "no-trailing-whitespace": "error"
  },
  "ignores": ["generated/**/*.feature"]
}
```

Every rule and its options are listed in [Rules](rules.md). [Configuration](configuration.md) covers overrides, presets, and inline suppression comments.

## Fix safely

Formatting rules such as `no-trailing-whitespace`, `no-extra-blank-lines`, `indentation`, and `use-and` have safe autofixes:

```sh
npx gherkin-refine features/ --fix-dry-run
npx gherkin-refine features/ --fix
```

A fix is applied only when the result still parses as valid Gherkin.

## Run in GitHub Actions

```yaml
name: Gherkin

on:
  push:
  pull_request:

permissions:
  contents: read

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22.18.0
          cache: npm
      - run: npm ci
      - run: npx gherkin-refine .
```

For code scanning, `--format sarif` writes SARIF output. [AI agent integration](agent-integration.md) covers JSON output for tools and agents.
