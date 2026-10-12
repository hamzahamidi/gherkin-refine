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

## Refactors and performance

A change meant to keep behavior can be compared with `main`:

```sh
git worktree add ../gherkin-refine-main main
cd ../gherkin-refine-main && npm ci && npm run build && cd -
npm run build
npm run differential -- ../gherkin-refine-main/dist dist
```

`differential` lints seeded random feature files, multi-file trees with symlinks, a probe plugin that records traversal order, and legacy configurations with both builds, and prints every difference. Version strings are ignored. An optional count and seed follow the two directories.

`npm run bench` times 1 to 1,000 files, and one file with up to 2,000 diagnostics, 200 suppression directives and 1,800 fixes.

## Pull requests

Use a [Conventional Commits](https://www.conventionalcommits.org/) title such as `fix: ...` or `feat: ...`. Describe what changes and how it was verified. Add a `CHANGELOG.md` entry for any change users can see.

## Security

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
