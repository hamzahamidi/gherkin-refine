import type { RuleModule } from "../../types.js";
import { lineDiagnostic, ruleDocs, trailingRunStart } from "../helpers.js";
import { checkedOptions, defineRule } from "../define.js";

export const formattingRules: Readonly<Record<string, RuleModule<unknown>>> = {
  "new-line-at-eof": defineRule({
    meta: {
      description: "Require or disallow a line break at the end of the file.",
      category: "formatting",
      recommended: false,
      fixable: true,
      defaultOptions: "yes",
      examples: ["Feature: no final line break"],
      documentation: ruleDocs("new-line-at-eof")
    },
    ...checkedOptions<"yes" | "no">((value) => value === "yes" || value === "no" ? undefined : 'options must be "yes" or "no"'),
    run({ document, options, report }) {
      const hasLineBreak = document.lines.at(-1) === "";
      const line = document.lines.length;
      if (!hasLineBreak && options === "yes") {
        report({ ...lineDiagnostic(document, line, "new-line-at-eof", "New line at EOF(end of file) is required."), fix: { range: [document.source.length, document.source.length], text: "\n" } });
      } else if (hasLineBreak && options === "no") {
        const trailingStart = trailingRunStart(document.source, (char) => char === "\n" || char === "\r");
        report({ ...lineDiagnostic(document, line, "new-line-at-eof", "New line at EOF(end of file) is not allowed."), fix: { range: [trailingStart, document.source.length], text: "" } });
      }
    }
  }),
};
