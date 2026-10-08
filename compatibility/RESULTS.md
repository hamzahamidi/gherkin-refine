# Compatibility results

Published npm `gherkin-refine@1.0.6`, comparison parser `@cucumber/gherkin@42.0.1`, October 8, 2026. Full manifest run on Node 26.5.1, macOS.

| Source | Valid | Intentionally invalid | Files changed | Permitted prose/comment AST changes | Failures |
| --- | ---: | ---: | ---: | ---: | ---: |
| cucumber/gherkin | 50 | 12 | 8 | 3 | 0 |
| cucumber/cucumber-js | 78 | 0 | 8 | 0 | 0 |
| cucumber/cucumber-ruby | 152 | 0 | 22 | 9 | 0 |
| Total | 280 | 12 | 38 | 12 | 0 |

All read-only hashes remain unchanged. All 38 changed valid files satisfy the source and AST preservation assertions. All valid files are unchanged by a second fix pass. The 12 invalid fixtures produce parser diagnostics and remain unchanged under fix mode.

The run takes 10.931 seconds including downloads and checks. Harness peak RSS is 118,800 KiB. These are single-run observations, not performance guarantees. Reproduce with `npm run compatibility:published`; inspect `compatibility-report.json` for individual findings and permitted differences.

Recommended-rule findings are recorded separately from parser and preservation failures. Upstream files can deliberately contain duplicate tags or unused outline placeholders, so a lint finding does not imply a compatibility defect.
