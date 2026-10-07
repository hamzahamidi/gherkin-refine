# gherkinlint

`gherkinlint` is a TypeScript Gherkin linter for Node.js projects. It uses the official Cucumber parser and provides a CLI, a JavaScript API, plugin rules, inline suppression, safe autofixes, JSON, NDJSON, and SARIF output.

It targets Node.js 22.18 or later. The runtime is ESM and parses Feature, Rule, Scenario, Background, Examples, localized keywords, data tables, and doc strings through `@cucumber/gherkin`.

## Install

```sh
npm install --save-dev gherkinlint
npx gherkinlint .
```

The CLI discovers `*.feature` files and ignores `.git`, `node_modules`, `dist`, and `coverage` while scanning directories. A directly named file is always linted. An explicitly named symlink to a file or directory is followed. Nested symlinked directories are not traversed.

## Zero configuration

The recommended rules run without a configuration file:

```sh
gherkinlint features/
```

Recommended rules check duplicate tags, duplicate Feature and Scenario names, and unused or undeclared Scenario Outline variables. Subjective style rules are off by default.

## Configuration

Create `gherkinlint.config.js`, `.mjs`, `.ts`, or `.json`:

```js
import { defineConfig } from "gherkinlint";

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

Severity accepts `off`, `warn`, `error`, `0`, `1`, or `2`. Options are checked before linting begins. TypeScript configuration uses Node's built in type stripping. It must use erasable TypeScript syntax and cannot rely on `tsconfig` path aliases or compiler transforms. Configuration and plugin files execute as trusted project code.

## CLI

```sh
gherkinlint .
gherkinlint "features/**/*.feature" --format json
gherkinlint features/login.feature --fix
gherkinlint features/login.feature --fix-dry-run --format json
cat generated.feature | gherkinlint --stdin --stdin-filename features/generated.feature
gherkinlint --list-rules --format json
gherkinlint --explain no-duplicate-tags
gherkinlint --print-config features/login.feature
gherkinlint migrate .gherkin-lintrc --dry-run
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
import { lintFiles, lintText } from "gherkinlint";

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
gherkinlint features/login.feature --format json --max-diagnostics 50
gherkinlint features/login.feature --fix-dry-run --format json
```

The result schema is in [`schemas/result.schema.json`](schemas/result.schema.json). See [`docs/agent-integration.md`](docs/agent-integration.md) for stdin, exit codes, truncation, rule introspection, and a remediation loop.

## Migration

`gherkinlint migrate .gherkin-lintrc --dry-run` reads the historical JSON format, including comments. It writes `gherkinlint.config.json` when run without `--dry-run`. It never replaces an existing output unless `--force` is supplied. The command reports unsupported rules and changed behavior. See [`docs/migration.md`](docs/migration.md).

## Development

```sh
npm ci
npm run validate
```

The package is MIT licensed. It has no telemetry and core rules make no network requests. See [`docs/architecture.md`](docs/architecture.md) and [`docs/rules.md`](docs/rules.md).

See [`docs/performance.md`](docs/performance.md) for the benchmark method and one local measurement.
