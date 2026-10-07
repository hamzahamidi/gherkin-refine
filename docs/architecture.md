# Architecture

```text
source acquisition
       ↓
official Cucumber parser
       ↓
LintDocument
       ↓
configuration resolution
       ↓
file rules
       ↓
project rules
       ↓
suppression processing
       ↓
diagnostic sorting and fix conflict checks
       ↓
formatter
```

The parser runs once for each source in a lint pass. `LintDocument` keeps original text, line starts, normalized paths, and the Cucumber AST. Traversal helpers visit Scenarios both directly under Feature and under Rule.

File rules receive one document and an immutable context. Project rules receive the sorted document set after file rules finish. Each rule receives severity and validated options from configuration. Async rule execution is awaited. Rule failures are execution errors with rule, plugin, and file information.

Suppressions filter diagnostics after the rules run. Fixes are source ranges. The engine rejects overlapping edits, applies non-overlapping edits from the end of the source, and repeats a bounded number of passes. File writes use a temporary file in the same directory followed by rename.

Formatters consume completed results. They do not run rules, mutate diagnostics, or write files. JSON and NDJSON contain no timestamps or terminal escape codes.
