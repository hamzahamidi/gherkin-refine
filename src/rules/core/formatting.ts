import type { RuleFix, RuleModule } from "../../types.js";
import { rangeDiagnostic, ruleDocs, trailingRunStart } from "../helpers.js";
import { docStringContentLines } from "./helpers.js";

export const formattingRules: Readonly<Record<string, RuleModule<unknown>>> = {
  "no-trailing-whitespace": {
    meta: {
      description: "Disallow trailing spaces and tabs.",
      category: "formatting",
      recommended: false,
      fixable: true,
      examples: ["Feature: title   "],
      documentation: ruleDocs("no-trailing-whitespace")
    },
    run({ document, report }) {
      const protectedLines = docStringContentLines(document);
      for (let index = 0; index < document.lines.length; index += 1) {
        if (protectedLines.has(index + 1)) continue;
        const line = document.lines[index] ?? "";
        const column = trailingRunStart(line, (char) => char === " " || char === "\t") + 1;
        const length = line.length + 1 - column;
        if (length === 0) continue;
        const lineNumber = index + 1;
        const start = document.offsetAt({ line: lineNumber, column });
        const fix: RuleFix = { range: [start, start + length], text: "" };
        report(rangeDiagnostic(document, lineNumber, column, length, "no-trailing-whitespace", "Trailing whitespace.", fix));
      }
    }
  },

  "no-extra-blank-lines": {
    meta: {
      description: "Allow at most one consecutive empty line.",
      category: "formatting",
      recommended: false,
      fixable: true,
      examples: ["Feature: title\n\n\nScenario: one"],
      documentation: ruleDocs("no-extra-blank-lines")
    },
    run({ document, report }) {
      let blankCount = 0;
      const hasFinalNewline = /(?:\r\n|\n|\r)$/.test(document.source);
      const protectedLines = docStringContentLines(document);
      for (let index = 0; index < document.lines.length; index += 1) {
        const line = document.lines[index] ?? "";
        if (protectedLines.has(index + 1)) continue;
        if (hasFinalNewline && index === document.lines.length - 1) continue;
        if (line.trim().length > 0) {
          blankCount = 0;
          continue;
        }
        blankCount += 1;
        if (blankCount <= 1) continue;
        const lineNumber = index + 1;
        const range = document.rangeForLine(lineNumber);
        const newlineEnd = document.source.startsWith("\r\n", range[1]) ? range[1] + 2 : range[1] + (range[1] < document.source.length ? 1 : 0);
        const fix: RuleFix = { range: [range[0], newlineEnd], text: "" };
        report(rangeDiagnostic(document, lineNumber, 1, Math.max(1, line.length), "no-extra-blank-lines", "Unexpected consecutive blank line.", fix));
      }
    }
  },
};
