import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { formatResult } from "../src/formatters/index.js";
import type { LintResult } from "../src/types.js";

function resultWithDiagnostics(): LintResult {
  return {
    schemaVersion: 1,
    tool: { name: "gherkin-refine", version: "1.0.3" },
    summary: { files: 1, errors: 1, warnings: 1, fixable: 0, truncated: true },
    results: [{
      filePath: "<stdin>",
      diagnostics: [
        {
          filePath: "<stdin>",
          ruleId: "z-rule",
          severity: "warn",
          message: "A warning",
          start: { line: 4, column: 2 },
          end: { line: 4, column: 8 },
          data: { source: "test" }
        },
        {
          filePath: "<stdin>",
          ruleId: "a-rule",
          severity: "error",
          message: "An error",
          start: { line: 1, column: 1 }
        }
      ],
      fixes: [{ range: [0, 1], text: "F" }]
    }]
  };
}

describe("formatResult", () => {
  it("formats stylish and compact output with quiet and truncation behavior", () => {
    const result = resultWithDiagnostics();
    const stylish = formatResult(result, "stylish");
    expect(stylish).toContain("<stdin>");
    expect(stylish).toContain("warning  A warning  z-rule");
    expect(stylish).toContain("error  An error  a-rule");
    expect(stylish).toContain("Diagnostics were truncated.");
    expect(stylish).toContain("1 error, 1 warning");

    const quietStylish = formatResult(result, "stylish", { quiet: true });
    expect(quietStylish).not.toContain("A warning");
    expect(quietStylish).toContain("An error");
    expect(quietStylish).toContain("1 error\n");

    const compact = formatResult(result, "compact");
    expect(compact).toContain("<stdin>:4:2: warn: A warning (z-rule)");
    expect(compact).toContain("results truncated");
    expect(compact).toContain("1 errors, 1 warnings");
    const quietCompact = formatResult(result, "compact", { quiet: true });
    expect(quietCompact).not.toContain("A warning");
    expect(quietCompact).toContain("An error");
    expect(quietCompact).toContain("1 errors\n");
  });

  it("serializes fixes to JSON and NDJSON and passes quiet results to custom formatters", () => {
    const result = resultWithDiagnostics();
    const json = JSON.parse(formatResult(result, "json"));
    expect(json.results[0].fixes).toEqual([{ range: [0, 1], text: "F" }]);
    expect(json.results[0].diagnostics).toHaveLength(2);

    const ndjson = formatResult(result, "ndjson").trim().split("\n").map((line) => JSON.parse(line));
    expect(ndjson.map((record) => record.type)).toEqual(["summary", "file"]);
    expect(ndjson[1].fixes).toEqual([{ range: [0, 1], text: "F" }]);

    const custom = JSON.parse(formatResult(result, (displayed) => JSON.stringify({
      diagnostics: displayed.results[0]?.diagnostics.map((item) => item.ruleId)
    }), { quiet: true }));
    expect(custom.diagnostics).toEqual(["a-rule"]);
  });

  it("emits SARIF metadata, locations, data, and a stable stdin artifact path", () => {
    const result = resultWithDiagnostics();
    const cwd = resolve("test workspace");
    const sarif = JSON.parse(formatResult(result, "sarif", {
      cwd,
      ruleMetadata: {
        "a-rule": { description: "Alpha rule", category: "correctness", recommended: true, fixable: true }
      }
    }));
    const run = sarif.runs[0];
    expect(sarif.version).toBe("2.1.0");
    expect(run.tool.driver.rules.map((rule: { id: string }) => rule.id)).toEqual(["a-rule", "z-rule"]);
    expect(run.tool.driver.rules[0].shortDescription.text).toBe("Alpha rule");
    expect(run.tool.driver.rules[0].properties).toEqual({ tags: ["correctness"], recommended: true, fixable: true });
    expect(run.tool.driver.rules[1].shortDescription.text).toBe("z-rule");
    expect(run.results[0].locations[0].physicalLocation.artifactLocation.uri)
      .toBe(pathToFileURL(resolve(cwd, "__stdin__.feature")).href);
    expect(run.results[0].locations[0].physicalLocation.region).toEqual({
      startLine: 4,
      startColumn: 2,
      endLine: 4,
      endColumn: 8
    });
    expect(run.results[0].properties).toEqual({ source: "test" });
    expect(run.results[1].level).toBe("error");
  });

  it("prints a lint free message when there are no diagnostics", () => {
    const result = resultWithDiagnostics();
    const lintFree: LintResult = {
      ...result,
      summary: { files: 1, errors: 0, warnings: 0, fixable: 0, truncated: false },
      results: [{ filePath: "empty.feature", diagnostics: [] }]
    };
    expect(formatResult(lintFree, "stylish")).toBe("✔ 1 file lint-free\n");
  });
});
