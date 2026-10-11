# Gherkin Refine

[![CI](https://img.shields.io/github/actions/workflow/status/hamzahamidi/gherkin-refine/ci.yml?branch=main&label=CI)](https://github.com/hamzahamidi/gherkin-refine/actions/workflows/ci.yml)
[![Code coverage](https://codecov.io/github/hamzahamidi/gherkin-refine/graph/badge.svg)](https://codecov.io/github/hamzahamidi/gherkin-refine)
[![npm version](https://img.shields.io/npm/v/gherkin-refine.svg)](https://www.npmjs.com/package/gherkin-refine)
[![Node.js](https://img.shields.io/node/v/gherkin-refine.svg)](https://www.npmjs.com/package/gherkin-refine)
[![License](https://img.shields.io/github/license/hamzahamidi/gherkin-refine.svg)](LICENSE)

A Gherkin and Cucumber linter, and a migration path from gherkin-lint.

Gherkin Refine supports all 31 gherkin-lint 4.2.4 rules, installs the same `gherkin-lint` command, and reads existing `.gherkin-lintrc` and `.gherkin-lintignore` files. It uses the official Cucumber parser and adds safe autofixes, plugins, inline suppression, and JSON, NDJSON, and SARIF output.

**Documentation:** [Documentation home](https://hamidihamza.com/gherkin-refine/) · [Get started](https://hamidihamza.com/gherkin-refine/getting-started) · [Migration guide](https://hamidihamza.com/gherkin-refine/migration) · [Rules](https://hamidihamza.com/gherkin-refine/rules)

**Tutorial:** [Original article](https://hamidihamza.com/notes/add-gherkin-linting-nodejs/) · [Medium](https://medium.com/@hamidihamza/add-gherkin-linting-to-a-node-js-project-0cc2bea2e2c0) · [DEV.to](https://dev.to/hamzahamidi/add-gherkin-linting-to-a-nodejs-project-3m8b)

## Quick start

```sh
npm install --save-dev gherkin-refine
npx gherkin-refine .
```

Requires Node.js 22.18 or later. The CLI finds `*.feature` files and skips `.git`, `node_modules`, `dist`, and `coverage` while scanning directories. See the [Getting started guide](https://hamidihamza.com/gherkin-refine/getting-started) for configuration and GitHub Actions setup.

Without a configuration file, recommended rules check duplicate tags and names, plus unused or undeclared Scenario Outline variables. Style rules are opt in. See the [rules reference](https://hamidihamza.com/gherkin-refine/rules) for the full list and defaults.

## Migrate from gherkin-lint

```sh
npm uninstall gherkin-lint
npm install --save-dev gherkin-refine
```

Scripts that call `gherkin-lint` keep working. The `gherkinlint` command is also available as an alias. Gherkin Refine reads `.gherkin-lintrc` and `.gherkin-lintignore` and supports all 31 built-in rules and the legacy CLI flags. Some behavior differs because the parser is newer and several gherkin-lint bugs are fixed. `xunit` output is unavailable, and custom `--rulesdir` rules need to be ported to a plugin. Review the [migration guide](https://hamidihamza.com/gherkin-refine/migration) before changing CI.

| | gherkin-lint 4.2.4 | Gherkin Refine |
| --- | --- | --- |
| Node.js | 10 or later | 22.18 or later |
| Gherkin parser | `gherkin` 9, deprecated | `@cucumber/gherkin` 42 |
| Built-in rules | 31 | 35, covering all 31 gherkin-lint rules |
| Severity | On or off | `off`, `warn`, `error` |
| Autofix | None | 6 opt-in whitespace and step keyword rules |
| Output formats | `stylish`, `json`, `xunit` | `stylish`, `compact`, `json`, `ndjson`, `sarif` |
| Inline suppression | None | `gherkin-refine-disable` comments |
| Custom rules | `--rulesdir` | Plugins. `--rulesdir` rules need porting |

Findings are not identical: the parser is newer, Scenarios inside `Rule` blocks are checked, and three gherkin-lint bugs are fixed. The [full comparison](https://hamidihamza.com/gherkin-refine/comparison) covers every difference and when gherkin-lint still fits.

## Safe fixes

Formatting rules are opt in. Preview fixes before applying them:

```sh
npx gherkin-refine features/ --fix-dry-run
npx gherkin-refine features/ --fix
```

A fix is applied only when the result still parses as valid Gherkin.

![Gherkin Refine previews whitespace findings, applies safe fixes, and checks the feature file again](https://hamidihamza.com/assets/gherkin-refine-fix-demo.gif)

## Configuration

Create `gherkin-refine.config.js`, `.mjs`, `.ts`, or `.json`:

```js
import { defineConfig } from "gherkin-refine";

export default defineConfig({
  extends: ["recommended"],
  rules: {
    "scenario-size": ["warn", { maxSteps: 12 }],
    "no-trailing-whitespace": "error"
  }
});
```

The [configuration guide](https://hamidihamza.com/gherkin-refine/configuration) covers overrides, ignores, presets, and inline suppression. Custom rules can be loaded as [plugins](https://hamidihamza.com/gherkin-refine/plugins).

## CLI and integrations

```sh
gherkin-refine .
gherkin-refine "features/**/*.feature" --format json
gherkin-refine features/login.feature --fix-dry-run
gherkin-refine --list-rules --format json
```

The CLI supports `stylish`, `compact`, `json`, `ndjson`, and `sarif` output. See [AI agent integration](https://hamidihamza.com/gherkin-refine/agent-integration) for structured output and agent workflows.

## API

```ts
import { lintFiles, lintText } from "gherkin-refine";

const textResult = await lintText(source, {
  filePath: "features/login.feature"
});

const filesResult = await lintFiles(["features/**/*.feature"]);
```

The API returns the same diagnostics and summary as the CLI. `lintFiles` can write safe fixes when called with `fix: true`. See the [architecture guide](https://hamidihamza.com/gherkin-refine/architecture) for parser and lint pipeline details.

## Development

```sh
npm ci
npm run validate
```

Gherkin Refine is independently maintained under the MIT license. It is not affiliated with Cucumber or gherkin-lint. It has no telemetry, and core rules make no network requests. Report bugs in [GitHub Issues](https://github.com/hamzahamidi/gherkin-refine/issues), ask questions in [GitHub Discussions](https://github.com/hamzahamidi/gherkin-refine/discussions), or report vulnerabilities using the [security policy](SECURITY.md).
