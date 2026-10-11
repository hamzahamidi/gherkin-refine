import { StepKeywordType } from "@cucumber/messages";
import type { RuleModule } from "../../types.js";
import { forEachScenario } from "../../parser/document.js";
import { lineDiagnostic, ruleDocs } from "../helpers.js";
import { stageName } from "./helpers.js";

const KEYWORD_STAGES: Partial<Record<StepKeywordType, number>> = {
  [StepKeywordType.CONTEXT]: 1,
  [StepKeywordType.ACTION]: 2,
  [StepKeywordType.OUTCOME]: 3
};

export const structureRules: Readonly<Record<string, RuleModule<unknown>>> = {
  "logical-keyword-order": {
    meta: {
      description: "Keep Given, When, and Then semantic stages in order.",
      category: "structure",
      recommended: false,
      examples: ["Then the user is signed in\nWhen the user opens the account page"],
      documentation: ruleDocs("logical-keyword-order")
    },
    run({ document, report }) {
      forEachScenario(document, (scenario) => {
        let stage = 0;
        for (const step of scenario.steps) {
          const type = step.keywordType;
          if (type === StepKeywordType.CONJUNCTION || type === StepKeywordType.UNKNOWN) continue;
          const next = KEYWORD_STAGES[type ?? StepKeywordType.UNKNOWN] ?? 0;
          if (next < stage) {
            report(lineDiagnostic(document, step.location.line, "logical-keyword-order", `Step keyword stage moves backward from ${stageName(stage)} to ${stageName(next)}.`));
          } else {
            stage = Math.max(stage, next);
          }
        }
      });
    }
  },
};
