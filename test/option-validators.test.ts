import { describe, expect, it } from "vitest";
import { fileRules, projectRules } from "../src/index.js";

const rules = { ...fileRules, ...projectRules };
const NOT_OBJECTS = [null, [], "x", 3, true];

const cases: Readonly<Record<string, { accepts: readonly unknown[]; rejects: readonly unknown[] }>> = {
  "scenario-size": {
    accepts: [{ maxSteps: 1 }, { maxSteps: 3, extra: 1 }],
    rejects: [{}, { maxSteps: 0 }, { maxSteps: -1 }, { maxSteps: 1.5 }, { maxSteps: "3" }]
  },
  "background-size": {
    accepts: [{ maxSteps: 5 }, { maxSteps: 2, extra: true }],
    rejects: [{}, { maxSteps: 0 }]
  },
  "feature-size": {
    accepts: [{ maxScenarios: 2 }, { maxScenarios: 2, countOutlineExamples: true }, { maxScenarios: 2, extra: 1 }],
    rejects: [{}, { maxScenarios: 0 }, { maxScenarios: 2, countOutlineExamples: "yes" }]
  },
  "name-length": {
    accepts: [{}, { max: 10 }, { Feature: 5 }, { Feature: 5, Step: 9 }],
    rejects: [{ max: 0 }, { max: 10, Feature: 5 }, { Feature: 0 }, { Bogus: 5 }, { toString: 5 }]
  },
  "tag-pattern": {
    accepts: [{ pattern: "^@a" }, { pattern: "^@a", extra: 1 }],
    rejects: [{}, { pattern: "(" }, { pattern: 3 }]
  },
  "allowed-tags": {
    accepts: [{}, { tags: ["@a"] }, { patterns: ["^@a"] }, { extra: 1 }],
    rejects: [{ patterns: ["("] }, { tags: "@a" }, { tags: [1] }]
  },
  "no-restricted-tags": {
    accepts: [{}, { tags: ["@a"], patterns: ["^@b"] }],
    rejects: [{ patterns: [3] }]
  },
  "new-line-at-eof": {
    accepts: ["yes", "no"],
    rejects: [{}, "maybe", { yes: true }]
  },
  indentation: {
    accepts: [{}, { Feature: 0, Step: 4 }, { "rule content": 2 }],
    rejects: [{ Feature: -1 }, { Feature: 1.5 }, { Bogus: 2 }, { toString: 2 }]
  },
  "required-tags": {
    accepts: [{}, { tags: ["^@jira"] }, { ignoreUntagged: false }],
    rejects: [{ tags: ["("] }, { ignoreUntagged: "no" }, { extra: 1 }]
  },
  "no-restricted-patterns": {
    accepts: [{}, { Global: ["TODO"] }],
    rejects: [{ Scenario: ["("] }, { Bogus: ["x"] }, { Global: "TODO" }, { toString: ["x"] }]
  },
  "file-name": {
    accepts: [{}, { style: "kebab-case" }],
    rejects: [{ style: "Nope" }, { style: "__proto__" }, { style: 3 }, { other: 1 }]
  },
  "no-duplicate-scenario-names": {
    accepts: [{}, { scope: "anywhere" }, { scope: "feature" }],
    rejects: [{ scope: "nope" }, { scope: "anywhere", extra: 1 }]
  }
};

describe("built-in option validators", () => {
  it("cover every rule that validates options", () => {
    expect(Object.keys(cases).sort()).toEqual(Object.entries(rules).filter(([, rule]) => rule.validateOptions).map(([id]) => id).sort());
  });

  describe.each(Object.entries(cases))("%s", (id, { accepts, rejects }) => {
    const rule = rules[id];

    it.each(accepts.map((value) => [JSON.stringify(value), value]))("accepts %s", (_, value) => {
      expect(rule?.validateOptions?.(value)).toBe(true);
      expect(rule?.optionsError?.(value)).toBeUndefined();
    });

    it.each([...rejects, ...NOT_OBJECTS].map((value) => [JSON.stringify(value), value]))("rejects %s with a reason", (_, value) => {
      expect(rule?.validateOptions?.(value)).toBe(false);
      expect(rule?.optionsError?.(value)).toMatch(/\S/);
    });
  });
});
