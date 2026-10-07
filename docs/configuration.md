# Configuration

Configuration files are `gherkinlint.config.js`, `gherkinlint.config.mjs`, `gherkinlint.config.ts`, and `gherkinlint.config.json`. The first matching file is searched from the working directory upward. Use `--config` to select a specific file.

The recommended preset is enabled when no `extends` field is provided. Set `extends: []` to disable preset rules. Rule severities are `off`, `warn`, and `error`, or their numeric forms `0`, `1`, and `2`. A rule can include options as `[severity, options]`.

```js
import { defineConfig } from "gherkinlint";

export default defineConfig({
  extends: ["recommended"],
  rules: {
    "scenario-size": ["warn", { maxSteps: 12 }]
  },
  overrides: [
    {
      files: ["legacy/**/*.feature"],
      rules: { "scenario-size": "off" }
    }
  ],
  ignores: ["generated/**/*.feature"],
  reportUnusedDisableDirectives: true,
  maxConcurrency: 8,
  maxFixPasses: 10
});
```

TypeScript config files run through Node's native type stripping on the supported runtime. Use erasable syntax only. Node does not apply `tsconfig` transforms, path aliases, or type checking when loading a config file.

## Inline suppression

Comments support `gherkinlint-disable-next-line`, `gherkinlint-disable-line`, `gherkinlint-disable-file`, `gherkinlint-disable`, and `gherkinlint-enable`. Use comma or whitespace separated rule IDs. A reason follows `--`.

```gherkin
# gherkinlint-disable-next-line name-length -- historical user-facing phrase
Scenario: A deliberately long scenario name
```

```gherkin
# gherkinlint-disable scenario-size
Scenario: Legacy scenario
  Given the existing steps remain unchanged
# gherkinlint-enable scenario-size
```

Run with `--report-unused-disable-directives` or set `reportUnusedDisableDirectives: true` to report suppressions that matched no diagnostics. The rule `unused-disable-directive` accepts `warn`, `error`, or `off` severity.

Configuration and plugin files execute as trusted JavaScript. They are not sandboxed.
