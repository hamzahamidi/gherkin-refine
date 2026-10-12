# Plugins

Plugins are trusted ESM modules. They can export file rules, project rules, and named presets.

```js
export default {
  rules: {
    "company-tag-policy": {
      meta: {
        description: "Require the company tag.",
        category: "tags",
        recommended: false
      },
      run({ document, report }) {
        const feature = document.feature;
        if (feature && !feature.tags.some((tag) => tag.name === "@company")) {
          report({
            message: "Add @company to the Feature.",
            start: { line: feature.location.line, column: 1 }
          });
        }
      }
    }
  },
  configs: {
    recommended: {
      rules: { "company-tag-policy": "error" }
    }
  }
};
```

```js
export default {
  plugins: ["gherkin-refine-plugin-company"],
  extends: ["recommended", "company/recommended"],
  rules: { "company/company-tag-policy": "warn" }
};
```

Rule calls may return a Promise. The engine awaits every call. A rejected rule fails linting with exit code 2 and identifies the plugin, rule, and file. Plugin imports resolve from the configuration directory. Missing plugins are not installed. There is no plugin sandbox and no network access in core rules.

## Rule IDs

A rule ID is the plugin namespace, a slash, and the rule key. The namespace is the last segment of the plugin's package name without a `gherkin-refine-plugin-`, `gherkinlint-plugin-` or `eslint-plugin-` prefix, so `gherkin-refine-plugin-company` and `@acme/gherkin-refine-plugin-company` both give `company/company-tag-policy`. A plugin loaded from a path with no `package.json` above it takes its file name as namespace, extension included.

## Rule options

`defineRule<Options>()` types `options` in `run` from `validateOptions`, so `run` needs no cast, and `satisfies` checks `defaultOptions` against the same type:

```ts
import { defineRule, forEachScenario, type PluginModule } from "gherkin-refine";

interface MaxTagsOptions {
  readonly max: number;
}

export const maxScenarioTags = defineRule<MaxTagsOptions>({
  meta: {
    description: "Limit the number of tags on a Scenario.",
    category: "tags",
    recommended: false,
    defaultOptions: { max: 3 } satisfies MaxTagsOptions
  },
  validateOptions: (options): options is MaxTagsOptions =>
    typeof options === "object" && options !== null && "max" in options
    && typeof options.max === "number" && Number.isInteger(options.max) && options.max > 0,
  run({ document, options, report }) {
    forEachScenario(document, (scenario) => {
      if (scenario.tags.length <= options.max) return;
      report({
        message: `Scenario has ${scenario.tags.length} tags; the limit is ${options.max}.`,
        start: { line: scenario.location.line, column: scenario.location.column ?? 1 }
      });
    });
  }
});

export default { rules: { "max-scenario-tags": maxScenarioTags } } satisfies PluginModule;
```

A setting without options passes `defaultOptions`, or `{}` when the rule has none, so `validateOptions` must accept `defaultOptions`. Every rule setting in the configuration is validated, overrides included, except a setting that only turns the rule `off`. Invalid options stop linting with exit code 2 and `Invalid options for rule "<id>" in <source>.`

An optional `optionsError(options)` returns why options are invalid, or `undefined` when they are valid. The message then ends with that reason, such as `Invalid options for rule "max-tags/max-scenario-tags" in configuration: max must be a positive integer.`

Node strips TypeScript types only outside `node_modules`. A local `.ts` plugin loads directly; publish compiled JavaScript.

## Project rules

A project rule exports under `projectRules` and checks the whole file set in one call, for example duplicate names across files. It runs once per lint run, after file rules and autofix passes. `defineRule` covers file rules only; type a project rule as `ProjectRuleModule<Options>`, which takes `validateOptions` and `defaultOptions` the same way.

- `documents` holds every linted document that parsed, including files where the rule is off.
- `report` takes a diagnostic with `filePath`. The engine replaces `ruleId` and `severity`, drops reports for files where the rule is off, and applies each file's severity.
- `options` come from the first file, in path order, where the rule is enabled. Overrides can change a project rule's severity for each file, but not its options.

Programmatic callers can pass a custom formatter function to `formatResult(result, formatter)`. Formatters receive a completed result and return a string. The CLI supports the built in formatters.
