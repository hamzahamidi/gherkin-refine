# Contributing

Open an issue or a discussion before a large change, so the approach can be agreed first. Small fixes can go straight to a pull request.

## Set up and check

```sh
npm ci
npm run validate
```

`validate` runs type checking, ESLint, the build, the rule page check, the tests (including the gherkin-lint 4.2.4 comparison in `test/gherkin-lint-parity.test.ts`), a package smoke test, and `npm pack --dry-run`.

## Rules and documentation

A new or changed rule needs tests, a row in `docs/rules.md`, and regenerated rule pages:

```sh
npm run docs:rules
```

Preview the documentation site with `npm run docs:dev`.

## Pull requests

Use a [Conventional Commits](https://www.conventionalcommits.org/) title such as `fix: ...` or `feat: ...`. Describe what changes and how it was verified. Add a `CHANGELOG.md` entry for any change users can see.

## Security

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
