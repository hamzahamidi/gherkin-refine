import { describe, expect, it } from "vitest";
import {
  forEachExamples,
  forEachRule,
  forEachScenario,
  forEachStep,
  forEachTag,
  parseGherkin,
  sourceRange
} from "../src/parser/document.js";

function parsedDocument(source: string) {
  const result = parseGherkin(source, "features/parser.feature");
  if (!result.document) throw new Error("Expected valid Gherkin.");
  return result.document;
}

describe("Gherkin document parsing", () => {
  it("reports parser failures with a usable source location", () => {
    const result = parseGherkin("Scenario: outside a Feature\n", "invalid.feature");

    expect(result.document).toBeUndefined();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toContain("expected:");
    expect(result.errors[0]?.location).toEqual({ line: 1, column: 1 });
  });

  it("maps positions and line ranges across CRLF and CR newlines", () => {
    const source = "Feature: Café\r\n  Scenario: Start\r    Given food\r\n";
    const document = parsedDocument(source);
    const scenarioOffset = source.indexOf("Scenario");

    expect(document.language).toBe("en");
    expect(document.positionAt(scenarioOffset)).toEqual({ line: 2, column: 3 });
    expect(document.offsetAt({ line: 2, column: 3 })).toBe(scenarioOffset);
    expect(document.offsetAt({ line: 0, column: 0 })).toBe(0);
    expect(document.offsetAt({ line: 100, column: 100 })).toBe(source.length);
    expect(document.positionAt(-1)).toEqual({ line: 1, column: 1 });
    expect(document.positionAt(source.length + 20)).toEqual({ line: 4, column: 1 });
    expect(document.textForRange(document.rangeForLine(1))).toBe("Feature: Café");
    expect(document.rangeForLine(0)).toEqual(document.rangeForLine(1));
    expect(document.rangeForLine(100)).toEqual([source.length, source.length]);
    expect(sourceRange(document, 2, 3, 8)).toEqual([scenarioOffset, scenarioOffset + 8]);
  });

  it("visits Feature and Rule scenarios, backgrounds, examples, steps, and tags", () => {
    const document = parsedDocument(`@feature
Feature: Checkout
  Background: cart setup
    Given a cart exists

  @direct
  Scenario: place an order
    When checkout completes

  @rule
  Rule: Promotion
    Background: promotion setup
      Given a promotion is active

    @nested
    Scenario Outline: apply a code
      When code <code> is entered
      Then a discount is applied

      @table
      Examples: valid codes
        | code |
        | SAVE |
`);
    const rules: string[] = [];
    const scenarios: string[] = [];
    const steps: string[] = [];
    const examples: string[] = [];
    const tags: string[] = [];

    forEachRule(document, (rule) => rules.push(rule.name));
    forEachScenario(document, (scenario) => scenarios.push(scenario.name));
    forEachStep(document, (step) => steps.push(step.text));
    forEachExamples(document, (example, location) => {
      examples.push(`${location.rule?.name}:${location.scenario?.name}:${example.name}`);
    });
    forEachTag(document, (tag) => tags.push(tag.name));

    expect(rules).toEqual(["Promotion"]);
    expect(scenarios).toEqual(["place an order", "apply a code"]);
    expect(steps).toEqual([
      "a cart exists",
      "checkout completes",
      "a promotion is active",
      "code <code> is entered",
      "a discount is applied"
    ]);
    expect(examples).toEqual(["Promotion:apply a code:valid codes"]);
    expect(tags.sort()).toEqual(["@direct", "@feature", "@nested", "@rule", "@table"]);
  });
});
