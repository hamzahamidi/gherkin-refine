# Configuration

Configuration files are `gherkin-refine.config.js`, `gherkin-refine.config.mjs`, `gherkin-refine.config.ts`, and `gherkin-refine.config.json`. The first matching file is searched from the working directory upward. Existing `gherkinlint.config.*` files are still discovered. Use `--config` to select a specific file. A `.gherkin-lintignore` file in the working directory adds its non-empty lines to `ignores`.

The recommended preset is enabled when no `extends` field is provided. Set `extends: []` to disable preset rules. Rule severities are `off`, `warn`, and `error`, or their numeric forms `0`, `1`, and `2`. A rule can include options as `[severity, options]`.

```js
import { defineConfig } from "gherkin-refine";

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

Comments support `gherkin-refine-disable-next-line`, `gherkin-refine-disable-line`, `gherkin-refine-disable-file`, `gherkin-refine-disable`, and `gherkin-refine-enable`. The previous `gherkinlint-*` forms remain accepted. Use comma or whitespace separated rule IDs. A reason follows `--`.

```gherkin
# gherkin-refine-disable-next-line name-length -- historical user-facing phrase
Scenario: A deliberately long scenario name
```

```gherkin
# gherkin-refine-disable scenario-size
Scenario: Legacy scenario
  Given the existing steps remain unchanged
# gherkin-refine-enable scenario-size
```

Run with `--report-unused-disable-directives` or set `reportUnusedDisableDirectives: true` to report suppressions that matched no diagnostics. The rule `unused-disable-directive` accepts `warn`, `error`, or `off` severity.

Configuration and plugin files execute as trusted JavaScript. They are not sandboxed.
