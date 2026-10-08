# AI agent integration

Agents should use structured output and avoid parsing human terminal text.

```sh
gherkin-refine features/login.feature --format json --max-diagnostics 50
gherkin-refine features/login.feature --fix-dry-run --format json
cat generated.feature | gherkin-refine --stdin --stdin-filename features/generated.feature --format json
```

The JSON schema is versioned at `schemaVersion: 1` and is available in [`../schemas/result.schema.json`](../schemas/result.schema.json). Diagnostics sort by normalized file path, line, column, then rule ID. Output contains no timestamps or random IDs. When `summary.truncated` is true, increase `--max-diagnostics` to retrieve more findings.

Exit code `0` means lint completed below the configured failure threshold. Code `1` means lint found errors or exceeded `--max-warnings`. Code `2` means invalid CLI usage, configuration, plugin loading, or rule execution. Syntax errors are diagnostics and use code `1`.

Use `gherkin-refine --explain <rule-id>` for a local rule explanation and `gherkin-refine --print-config <file>` to inspect effective settings. Normal commands are non-interactive. `--fix-dry-run` reports only safe proposed edits. Do not apply suggestions as automatic edits unless the result marks them as fixes.

Agent loop:

```text
lint
→ parse JSON
→ inspect diagnostics and proposed fixes
→ edit affected source ranges
→ lint affected files again
→ stop when errors are zero
```

The CLI makes no network requests during core linting and never sends feature text elsewhere.
