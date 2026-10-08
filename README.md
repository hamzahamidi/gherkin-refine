# Gherkin Refine

[![CI](https://img.shields.io/github/actions/workflow/status/hamzahamidi/gherkin-refine/ci.yml?branch=main&label=CI)](https://github.com/hamzahamidi/gherkin-refine/actions/workflows/ci.yml)
[![Code coverage](https://codecov.io/github/hamzahamidi/gherkin-refine/graph/badge.svg)](https://codecov.io/github/hamzahamidi/gherkin-refine)
[![npm version](https://img.shields.io/npm/v/gherkin-refine.svg)](https://www.npmjs.com/package/gherkin-refine)
[![Node.js](https://img.shields.io/node/v/gherkin-refine.svg)](https://www.npmjs.com/package/gherkin-refine)
[![License](https://img.shields.io/github/license/hamzahamidi/gherkin-refine.svg)](LICENSE)
[![Sponsor](https://img.shields.io/badge/sponsor-GitHub-ff69b4.svg)](https://github.com/sponsors/hamzahamidi)

Gherkin Refine is a TypeScript Gherkin linter for Node.js projects. It uses the official Cucumber parser and provides a CLI, a JavaScript API, plugin rules, inline suppression, safe autofixes, JSON, NDJSON, and SARIF output.

It targets Node.js 22.18 or later. The runtime is ESM and parses Feature, Rule, Scenario, Background, Examples, localized keywords, data tables, and doc strings through `@cucumber/gherkin`.

## Install

```sh
npm install --save-dev gherkin-refine
npx gherkin-refine .
```

The `gherkinlint` command remains available as a compatibility alias.

To use `gherkinlint` as the package import name in a project, install a local npm alias with `npm install --save-dev gherkinlint@npm:gherkin-refine`. This alias is specific to that project. The public package name remains `gherkin-refine`.

The CLI discovers `*.feature` files and ignores `.git`, `node_modules`, `dist`, and `coverage` while scanning directories. A directly named file is always linted. An explicitly named symlink to a file or directory is followed. Nested symlinked directories are not traversed.

## GitHub Actions

After installing `gherkin-refine` as a development dependency, add this workflow to lint feature files on pushes and pull requests:

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

## Zero configuration

The recommended rules run without a configuration file:

```sh
gherkin-refine features/
```

Recommended rules check duplicate tags, duplicate Feature and Scenario names, and unused or undeclared Scenario Outline variables. Subjective style rules are off by default.

## Safe fix preview

Formatting rules are opt in. Enable `no-extra-blank-lines` in `gherkin-refine.config.json`:

```json
{
  "rules": {
    "no-extra-blank-lines": "error"
  }
}
```

Given `features/checkout.feature`:

```gherkin
Feature: Checkout


  Scenario: place an order
    Given a customer has items in their basket
    When they complete checkout
    Then the order is placed
```

Preview the safe fix without changing the file:

```sh
npx gherkin-refine features/checkout.feature --fix-dry-run
```

```text
features/checkout.feature
  3:1  error  Unexpected consecutive blank line.  no-extra-blank-lines

1 error, 0 warnings
```

Run the same command with `--fix` to remove the extra blank line. The file then has one blank line between the Feature and Scenario.

## Configuration

Create `gherkin-refine.config.js`, `.mjs`, `.ts`, or `.json`:

```js
import { defineConfig } from "gherkin-refine";

export default defineConfig({
  extends: ["recommended"],
  rules: {
    "scenario-size": ["warn", { maxSteps: 12 }],
    "no-trailing-whitespace": "error",
    "name-length": "off"
  },
  overrides: [
    {
      files: ["legacy/**/*.feature"],
      rules: { "scenario-size": "off" }
    }
  ],
  ignores: ["generated/**/*.feature"]
});
```

Existing `gherkinlint.config.*` files are still discovered.

Severity accepts `off`, `warn`, `error`, `0`, `1`, or `2`. Options are checked before linting begins. TypeScript configuration uses Node's built in type stripping. It must use erasable TypeScript syntax and cannot rely on `tsconfig` path aliases or compiler transforms. Configuration and plugin files execute as trusted project code.

## CLI

```sh
gherkin-refine .
gherkin-refine "features/**/*.feature" --format json
gherkin-refine features/login.feature --fix
gherkin-refine features/login.feature --fix-dry-run --format json
cat generated.feature | gherkin-refine --stdin --stdin-filename features/generated.feature
gherkin-refine --list-rules --format json
gherkin-refine --explain no-duplicate-tags
gherkin-refine --print-config features/login.feature
gherkin-refine migrate .gherkin-lintrc --dry-run
```

Output formats are `stylish`, `compact`, `json`, `ndjson`, and `sarif`. JSON uses schema version 1. NDJSON emits one summary record followed by one record per file. `--max-diagnostics` limits emitted diagnostics and sets `summary.truncated`. `--max-warnings` sets the CI warning threshold. `--quiet` emits error diagnostics only. Use `--absolute-paths` when a machine consumer needs absolute result paths.

Exit codes are stable:

| Code | Meaning |
| --- | --- |
| `0` | Lint completed below the configured failure threshold |
| `1` | Lint completed with errors or too many warnings |
| `2` | Invalid configuration, CLI usage, plugin loading, or rule execution failure |

Gherkin syntax errors are lint diagnostics and return code 1.

## API

```ts
import { lintFiles, lintText } from "gherkin-refine";

const textResult = await lintText(source, {
  filePath: "features/login.feature",
  config: { rules: { "scenario-size": ["warn", { maxSteps: 12 }] } }
});

const filesResult = await lintFiles(["features/**/*.feature"], {
  cwd: process.cwd(),
  concurrency: 8
});
```

The API returns the same diagnostics and summary used by the machine formatters. `lintText` accepts an `AbortSignal`, and async rules receive that signal. `lintText` with `fix: true` returns the updated text in the file result. `lintFiles` with `fix: true` writes each changed file atomically.

Custom rules can be published as ESM plugins. Plugins export `rules`, optional `projectRules`, and optional `configs`. Missing plugins are never installed automatically. Plugins are trusted executable JavaScript and are not sandboxed.

## AI agent workflow

Use JSON output rather than parsing terminal prose:

```sh
gherkin-refine features/login.feature --format json --max-diagnostics 50
gherkin-refine features/login.feature --fix-dry-run --format json
```

The result schema is in [`schemas/result.schema.json`](schemas/result.schema.json). See [`docs/agent-integration.md`](docs/agent-integration.md) for stdin, exit codes, truncation, rule introspection, and a remediation loop.

## Migration

`gherkin-refine migrate .gherkin-lintrc --dry-run` reads the historical JSON format, including comments. It writes `gherkin-refine.config.json` when run without `--dry-run`. It never replaces an existing output unless `--force` is supplied. The command reports unsupported rules and changed behavior. See [`docs/migration.md`](docs/migration.md).

## Development

```sh
npm ci
npm run validate
npm run coverage
```

Coverage reports include lines, branches, functions, and statements for library modules. CLI behavior has separate process-level tests. CI checks minimum coverage of 70% for lines and functions, 68% for statements, and 50% for branches. HTML and LCOV reports are attached to the CI run for 14 days.

The package is MIT licensed. It has no telemetry and core rules make no network requests. See [`docs/architecture.md`](docs/architecture.md) and [`docs/rules.md`](docs/rules.md).

See [`docs/performance.md`](docs/performance.md) for the benchmark method and one local measurement.
