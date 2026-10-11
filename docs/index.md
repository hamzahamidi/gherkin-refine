---
layout: home

hero:
  name: Gherkin Refine
  text: A Gherkin linter you can trust in CI
  tagline: Fast, deterministic linting and safe fixes for Cucumber feature files, built on the official parser.
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: Migrate from gherkin-lint
      link: /migration
    - theme: alt
      text: Browse the rules
      link: /rules

features:
  - title: Drop-in for gherkin-lint
    details: Installs a gherkin-lint command, reads .gherkin-lintrc and .gherkin-lintignore, and supports every gherkin-lint 4.2.4 rule.
  - title: Safe autofix
    details: Whitespace, indentation, and keyword fixes are applied only when the result still parses as valid Gherkin.
  - title: Modern Gherkin
    details: Uses @cucumber/gherkin, so Rule blocks, Example and Scenario Template keywords, and localized dialects parse as Cucumber does.
  - title: Built for CI and agents
    details: Stable exit codes, plus stylish, compact, JSON, NDJSON, and SARIF output.
---

## Install

```sh
npm install --save-dev gherkin-refine
npx gherkin-refine .
```

Requires Node.js 22.18 or later. Continue to [Getting started](getting-started.md) for configuration, safe fixes, and GitHub Actions.

Read the practical tutorial on [the original site](https://hamidihamza.com/notes/add-gherkin-linting-nodejs/), [Medium](https://medium.com/@hamidihamza/add-gherkin-linting-to-a-node-js-project-0cc2bea2e2c0), or [DEV.to](https://dev.to/hamzahamidi/add-gherkin-linting-to-a-nodejs-project-3m8b).

## Guides

1. [Getting started](getting-started.md) installs the CLI, runs it in GitHub Actions, and applies safe fixes.
2. [Migration](migration.md) describes migrating from `gherkin-lint`.
3. [Configuration](configuration.md) explains config files, rule options, overrides, and inline suppression.
4. [Rules](rules.md) lists the built in rules and their defaults.
5. [Plugins](plugins.md) explains how to write and load custom rules.
6. [AI agent integration](agent-integration.md) covers structured output and an agent remediation loop.

## Technical notes

1. [Architecture](architecture.md) describes the parser, lint pipeline, and public interfaces.
2. [Performance](performance.md) documents the benchmark method and a local measurement.
