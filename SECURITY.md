# Security policy

## Supported versions

Security fixes ship in the latest published release of `gherkin-refine`. Older releases do not receive fixes.

## Reporting a vulnerability

Report vulnerabilities privately through [GitHub private vulnerability reporting](https://github.com/hamzahamidi/gherkin-refine/security/advisories/new). Do not open a public issue for an unpatched vulnerability.

Include the affected version, the steps to reproduce, what you expected, what happened, and the impact you see. Reports are reviewed by the maintainer; there is no fixed response time.

## Trust boundaries

Configuration files written in JavaScript or TypeScript, and plugins, run as trusted project code. Plugins are not sandboxed. A `.gherkin-lintrc` or JSON configuration is data and does not execute code.

Linting reads feature files locally. Gherkin Refine has no telemetry and its core rules make no network requests.
