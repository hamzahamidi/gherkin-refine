# Support policy

Gherkin Refine has one maintainer, [@hamzahamidi](https://github.com/hamzahamidi), who started it to keep gherkin-lint users on a maintained tool. There is no fixed release schedule, response time or second maintainer. This page states what users can rely on and what it costs to leave.

## Getting help

- **Bugs:** open an [issue](https://github.com/hamzahamidi/gherkin-refine/issues) with the version, the command, a minimal feature file and the output.
- **Questions and ideas:** start a [discussion](https://github.com/hamzahamidi/gherkin-refine/discussions).
- **Vulnerabilities:** report them privately as the [security policy](SECURITY.md) describes.

Contributions are welcome; [CONTRIBUTING.md](CONTRIBUTING.md) explains the checks a change must pass.

## Versions

Releases follow [Semantic Versioning](https://semver.org). The public interface is:

- the CLI commands, flags and exit codes
- the configuration formats, built-in rule IDs and their options
- the suppression comment syntax
- the exports of the package entry point, including the plugin interface
- the JSON output, versioned by its `schemaVersion` field

An intentional breaking change to any of these ships only in a new major version. A bug fix can change which findings a rule reports.

Fixes ship in the latest release only, including after a new major version. Older releases do not receive backports.

Releases are published to npm by the [release workflow](.github/workflows/release.yml) from a `vX.Y.Z` tag, with [npm provenance](https://docs.npmjs.com/generating-provenance-statements). The [changelog](CHANGELOG.md) records the user-visible changes in each release.

## Node.js

The `engines` field in `package.json` sets the minimum, currently Node.js 22.18.0. CI tests 22.18.0, 24 and 26 on Linux, and 22.18.0 on macOS and Windows. Node.js releases past their upstream end of life are not supported, even when they still install. Raising the minimum ships in a new major version.

## gherkin-lint compatibility

The `gherkin-lint` command, `.gherkin-lintrc` and `.gherkin-lintignore` stay supported in every 1.x release. CI runs `gherkin-lint` 4.2.4 on fixtures that cover each of its rules and compares the findings of both tools rule by rule, by location, line content, file, count or subset. The [migration guide](docs/migration.md) lists the known differences.

## If maintenance stops

A planned end of maintenance is announced in the README, the npm package is deprecated rather than unpublished, and the repository is archived.

The code is [MIT licensed](LICENSE). A fork has to run its own releases and publish under a different npm name.

To return to `gherkin-lint` 4.2.4, replace the dependency and keep the existing `.gherkin-lintrc`, `.gherkin-lintignore` and CLI flags. Native configuration, plugins, rules that gherkin-lint lacks and inline suppression comments do not carry over, and findings and exit codes can differ, so compare a CI run before switching.
