import type { Diagnostic, RuleFix } from "../types.js";
import { LintExecutionError } from "./errors.js";
import { compareText } from "./ordering.js";

export function selectFixes(diagnostics: readonly Diagnostic[], filePath: string): { fixes: RuleFix[]; conflicts: Diagnostic[] } {
  const candidates = diagnostics.flatMap((diagnostic) => diagnostic.fix ? [{ diagnostic, fix: diagnostic.fix }] : []);
  candidates.sort((left, right) => left.fix.range[0] - right.fix.range[0] || left.fix.range[1] - right.fix.range[1] || compareText(left.diagnostic.ruleId, right.diagnostic.ruleId));
  const conflicting = overlappingIndexes(candidates.map((candidate) => candidate.fix));
  const fixes: RuleFix[] = [];
  const conflicts: Diagnostic[] = [];
  candidates.forEach((candidate, index) => {
    if (!conflicting.has(index)) fixes.push(candidate.fix);
    else conflicts.push({
      filePath,
      ruleId: "fix-conflict",
      severity: "error",
      message: `Autofix from ${candidate.diagnostic.ruleId} overlaps another proposed edit.`,
      start: candidate.diagnostic.start,
      data: { conflictingRule: candidate.diagnostic.ruleId }
    });
  });
  return { fixes, conflicts: dedupeDiagnostics(conflicts) };
}

export function applyFixes(source: string, fixes: readonly RuleFix[]): string {
  let output = source;
  for (const fix of [...fixes].sort((left, right) => right.range[0] - left.range[0] || right.range[1] - left.range[1])) {
    if (fix.range[0] < 0 || fix.range[1] < fix.range[0] || fix.range[1] > output.length) {
      throw new LintExecutionError(`Autofix range ${fix.range.join(":")} is outside the source file.`);
    }
    output = output.slice(0, fix.range[0]) + fix.text + output.slice(fix.range[1]);
  }
  return output;
}

function overlappingIndexes(fixes: readonly RuleFix[]): Set<number> {
  const overlapping = new Set<number>();
  fixes.forEach((first, left) => {
    fixes.forEach((second, right) => {
      if (right <= left || !fixesOverlap(first, second)) return;
      overlapping.add(left);
      overlapping.add(right);
    });
  });
  return overlapping;
}

function fixesOverlap(left: RuleFix, right: RuleFix): boolean {
  const [leftStart, leftEnd] = left.range;
  const [rightStart, rightEnd] = right.range;
  const leftInsert = leftStart === leftEnd;
  const rightInsert = rightStart === rightEnd;
  if (leftInsert && rightInsert) return leftStart === rightStart;
  if (leftInsert) return leftStart >= rightStart && leftStart <= rightEnd;
  if (rightInsert) return rightStart >= leftStart && rightStart <= leftEnd;
  return leftStart < rightEnd && rightStart < leftEnd;
}

function dedupeDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter((diagnostic) => {
    const key = `${diagnostic.filePath}:${diagnostic.start.line}:${diagnostic.start.column}:${diagnostic.ruleId}:${diagnostic.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
