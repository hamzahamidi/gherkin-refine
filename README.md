# Gherkin Refine

[![CI](https://img.shields.io/github/actions/workflow/status/hamzahamidi/gherkin-refine/ci.yml?branch=main&label=CI)](https://github.com/hamzahamidi/gherkin-refine/actions/workflows/ci.yml)
[![SonarQube Cloud Coverage](https://sonarcloud.io/api/project_badges/measure?project=hamzahamidi_gherkin-refine&metric=coverage)](https://sonarcloud.io/component_measures?id=hamzahamidi_gherkin-refine&metric=coverage)
[![SonarQube Cloud Quality Gate](https://sonarcloud.io/api/project_badges/measure?project=hamzahamidi_gherkin-refine&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=hamzahamidi_gherkin-refine)
[![SonarQube Cloud Maintainability Rating](https://sonarcloud.io/api/project_badges/measure?project=hamzahamidi_gherkin-refine&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=hamzahamidi_gherkin-refine)
[![SonarQube Cloud Reliability Rating](https://sonarcloud.io/api/project_badges/measure?project=hamzahamidi_gherkin-refine&metric=reliability_rating)](https://sonarcloud.io/summary/new_code?id=hamzahamidi_gherkin-refine)
[![SonarQube Cloud Security Rating](https://sonarcloud.io/api/project_badges/measure?project=hamzahamidi_gherkin-refine&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=hamzahamidi_gherkin-refine)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/hamzahamidi/gherkin-refine/badge)](https://scorecard.dev/viewer/?uri=github.com/hamzahamidi/gherkin-refine)
[![npm version](https://img.shields.io/npm/v/gherkin-refine.svg)](https://www.npmjs.com/package/gherkin-refine)
[![Node.js](https://img.shields.io/node/v/gherkin-refine.svg)](https://www.npmjs.com/package/gherkin-refine)
[![License](https://img.shields.io/github/license/hamzahamidi/gherkin-refine.svg)](LICENSE)

**Lint Gherkin and Cucumber feature files with safe fixes and predictable CI output.**

Gherkin Refine checks `.feature` files with the official Cucumber parser. It catches structural mistakes, enforces configurable conventions, and offers opt-in autofixes validated against the parser. It also provides a migration path from `gherkin-lint`.

[**Documentation**](https://hamidihamza.com/gherkin-refine/) | [Get started](https://hamidihamza.com/gherkin-refine/getting-started) | [Rules](https://hamidihamza.com/gherkin-refine/rules) | [Migration](https://hamidihamza.com/gherkin-refine/migration) | [Plugins](https://hamidihamza.com/gherkin-refine/plugins)

## Quick start

Requires **Node.js 22.18 or later**.

```sh
npm install --save-dev gherkin-refine
npx gherkin-refine .
```

The CLI discovers `*.feature` files and skips common generated directories. With no configuration, five recommended rules check duplicate tags, duplicate Feature and Scenario names, and unused or undefined Scenario Outline variables. Style rules are opt-in.

## What you get

- **Modern Gherkin support:** Uses `@cucumber/gherkin`, including `Rule` blocks and localized keywords.
- **Built-in rules:** Covers all 31 `gherkin-lint` 4.2.4 rules, plus additional checks. Rules support `off`, `warn`, and `error` severity.
- **Safe, optional fixes:** Handles selected whitespace, indentation, and step-keyword problems, then reparses edited source before writing.
- **Automation-friendly output:** `stylish`, `compact`, `json`, `ndjson`, and `sarif` formats, stable exit codes, and a versioned JSON result schema.
- **Extensibility:** Plugins for file and project rules, with typed TypeScript rule options and runtime validation.

This is a linter, not a Cucumber test runner: it does not execute step definitions or scenarios.

## Configure rules

Create `gherkin-refine.config.mjs`:

```js
import { defineConfig } from "gherkin-refine";

export default defineConfig({
  extends: ["recommended"],
  rules: {
    "scenario-size": ["warn", { maxSteps: 12 }],
    "no-trailing-whitespace": "error"
  },
  ignores: ["generated/**/*.feature"]
});
```

The recommended preset is on by default for native configuration; use `extends: []` to opt out. Configurations support per-file overrides, rule options, and inline suppression comments.

Read the [configuration guide](https://hamidihamza.com/gherkin-refine/configuration) or browse the [rule reference](https://hamidihamza.com/gherkin-refine/rules).

## Preview and apply safe fixes

```sh
npx gherkin-refine features/ --fix-dry-run
npx gherkin-refine features/ --fix
```

`--fix-dry-run` reports proposed edits without writing files. `--fix` selects non-overlapping edits and reparses the result; an edit that would leave invalid Gherkin stops the run without writing any file. Only rules explicitly offering fixes can modify source.

![Gherkin Refine previews findings, applies safe fixes, and checks the feature file again](https://hamidihamza.com/assets/gherkin-refine-fix-demo.gif)

## Migrate from gherkin-lint

```sh
npm uninstall gherkin-lint
npm install --save-dev gherkin-refine
npx gherkin-lint .
```

Gherkin Refine provides the `gherkin-lint` and `gherkinlint` command aliases and reads `.gherkin-lintrc` and `.gherkin-lintignore`. Existing scripts can continue to call `gherkin-lint`. Preview a native config conversion with:

```sh
npx gherkin-refine migrate .gherkin-lintrc --dry-run
```

**It is a migration path, not an identical-behavior mode.** Some legacy rule IDs are renamed or split. The newer parser and wider `Rule`-block coverage can change findings. `xunit` output is unavailable, custom `--rulesdir` rules must be ported to plugins, and Node.js 22.18+ is required.

Compare findings and exit codes before switching CI. See the [migration guide](https://hamidihamza.com/gherkin-refine/migration) for rule mappings and the [feature comparison](https://hamidihamza.com/gherkin-refine/comparison) for compatibility limits.

## CI and AI coding agents

```sh
# Human-readable CI output
npx gherkin-refine . --format compact

# Structured results for code scanning and agents
npx gherkin-refine . --format sarif
npx gherkin-refine . --format json --max-diagnostics 100

# Inspect rules and effective settings
npx gherkin-refine --list-rules --format json
npx gherkin-refine --print-config features/login.feature
```

| Exit code | Meaning |
| --- | --- |
| `0` | Lint completed with no errors and within the warning threshold |
| `1` | Lint errors, Gherkin syntax errors, or too many warnings |
| `2` | Usage, configuration, plugin-loading, or rule-execution failure |

JSON results have deterministic ordering and follow the [versioned result schema](schemas/result.schema.json). Use `--explain <rule-id>` to inspect a rule's description, defaults, and effective settings.

[GitHub Actions example](https://hamidihamza.com/gherkin-refine/getting-started#run-in-github-actions) | [AI agent integration](https://hamidihamza.com/gherkin-refine/agent-integration)

## Programmatic API

Use the ESM API from JavaScript or TypeScript:

```ts
import { lintText, lintFiles } from "gherkin-refine";

const source = [
  "Feature: Search",
  "  Scenario: find a restaurant",
  "    Given restaurants are available"
].join("\n");

const oneFile = await lintText(source, {
  filePath: "features/search.feature"
});
const project = await lintFiles(["features/**/*.feature"]);

console.log(oneFile.summary, project.summary);
```

`lintFiles` also supports `fix: true` for safe, programmatic fixes. See [architecture](https://hamidihamza.com/gherkin-refine/architecture) for the parser, rule, and fix pipeline.

## Plugins

Plugins can export file rules, project rules, and named presets. TypeScript authors can use `defineRule<TOptions>()` and `validateOptions` for typed rule options checked at runtime. Plugin modules run as trusted project code; they are not sandboxed.

See the [plugin guide](https://hamidihamza.com/gherkin-refine/plugins) for a complete typed example.

## Contributing

```sh
npm ci
npm run validate
```

`validate` runs type checking, linting, the build, documentation checks, tests, and package verification. See [CONTRIBUTING.md](CONTRIBUTING.md), open an [issue](https://github.com/hamzahamidi/gherkin-refine/issues), or start a [discussion](https://github.com/hamzahamidi/gherkin-refine/discussions).

## License, support and security

Gherkin Refine is [MIT licensed](LICENSE) and independently maintained; it is not affiliated with Cucumber or `gherkin-lint`. It has no telemetry, and core rules make no network requests. Report vulnerabilities privately via the [security policy](SECURITY.md). The [support policy](SUPPORT.md) covers versions, Node.js support and how to leave the project.

GitHub releases include a Sigstore bundle for the npm package. Download the `.tgz` and `.sigstore.json` assets, then verify the package with Cosign:

```sh
VERSION=1.4.2
cosign verify-blob \
  --bundle "gherkin-refine-$VERSION.tgz.sigstore.json" \
  --certificate-identity "https://github.com/hamzahamidi/gherkin-refine/.github/workflows/release.yml@refs/tags/v$VERSION" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  "gherkin-refine-$VERSION.tgz"
```

Background reading: [original tutorial](https://hamidihamza.com/notes/add-gherkin-linting-nodejs/) | [DEV.to](https://dev.to/hamzahamidi/add-gherkin-linting-to-a-nodejs-project-3m8b) | [Medium](https://medium.com/@hamidihamza/add-gherkin-linting-to-a-node-js-project-0cc2bea2e2c0).
