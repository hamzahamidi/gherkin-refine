import type { RuleModule } from "../../types.js";
import { dialects } from "@cucumber/gherkin";
import { keywordKey, stepGroups } from "./helpers.js";
import { rangeDiagnostic, ruleDocs } from "../helpers.js";

export const stepsRules: Readonly<Record<string, RuleModule<unknown>>> = {
  "use-and": {
    meta: {
      description: "Require And instead of repeating the previous step keyword.",
      category: "formatting",
      recommended: false,
      fixable: true,
      examples: ["Given a cart\nGiven a coupon"],
      documentation: ruleDocs("use-and")
    },
    run({ document, report }) {
      if (!document.feature) return;
      const andKeyword = dialects[document.language]?.and.find((keyword) => keyword.trim() !== "*") ?? "And ";
      for (const steps of stepGroups(document.feature)) {
        let previous: string | undefined;
        for (const step of steps) {
          const key = keywordKey(step.keyword, document.language);
          if (key === "and") continue;
          if (key === previous) {
            const column = step.location.column ?? 1;
            const start = document.offsetAt({ line: step.location.line, column });
            report(rangeDiagnostic(document, step.location.line, column, step.keyword.length, "use-and",
              `Step "${step.keyword}${step.text}" should use And instead of ${step.keyword.trim()}.`,
              { range: [start, start + step.keyword.length], text: andKeyword }));
          }
          previous = key;
        }
      }
    }
  },
};
