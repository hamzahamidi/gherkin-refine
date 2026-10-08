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

Plugin names can use the `gherkin-refine-plugin-` prefix. The previous `gherkinlint-plugin-` prefix remains accepted.

Programmatic callers can pass a custom formatter function to `formatResult(result, formatter)`. Formatters receive a completed result and return a string. The CLI supports the built in formatters.
