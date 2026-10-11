import type { Diagnostic, LintDocument, Position, Severity } from "../types.js";

interface Directive {
  readonly kind: "disable" | "enable" | "disable-next-line" | "disable-line" | "disable-file";
  readonly line: number;
  readonly rules: readonly string[] | null;
  readonly reason?: string;
  used: boolean;
}

const DIRECTIVE = /^\s*#\s*(?:gherkin-refine|gherkinlint)-(disable-next-line|disable-line|disable-file|disable|enable)(?:\s+(.*))?\s*$/;

export function applySuppressions(
  document: LintDocument,
  diagnostics: readonly Diagnostic[],
  reportUnused: boolean,
  unusedSeverity: Exclude<Severity, "off"> = "warn"
): readonly Diagnostic[] {
  const directives = parseDirectives(document);
  const visible: Diagnostic[] = [];
  for (const diagnostic of diagnostics) {
    if (isSuppressed(directives, diagnostic)) continue;
    visible.push(diagnostic);
  }
  if (reportUnused) {
    for (const directive of directives) {
      if (directive.used || directive.kind === "enable") continue;
      const lineText = document.lines[directive.line - 1] ?? "";
      const position: Position = { line: directive.line, column: Math.max(1, lineText.indexOf("#") + 1) };
      visible.push({
        filePath: document.filePath,
        ruleId: "unused-disable-directive",
        severity: unusedSeverity,
        message: "Disable directive did not suppress any diagnostics.",
        start: position,
        ...(directive.reason ? { data: { reason: directive.reason } } : {})
      });
    }
  }
  return visible;
}

function parseDirectives(document: LintDocument): Directive[] {
  const directives: Directive[] = [];
  for (const comment of document.ast.comments) {
    const line = comment.location.line;
    const match = comment.text.match(DIRECTIVE);
    if (!match) continue;
    const kind = match[1] as Directive["kind"];
    const [rulePart, reasonPart] = (match[2] ?? "").split(/\s+--\s+/, 2);
    const list = rulePart?.split(/[\s,]+/).map((rule) => rule.trim()).filter(Boolean);
    const rules = list && list.length > 0 ? list : null;
    const reason = reasonPart?.trim();
    directives.push({ kind, line, rules, ...(reason ? { reason } : {}), used: false });
  }
  return directives.sort((left, right) => left.line - right.line);
}

interface BlockState {
  readonly disableAll: Set<Directive>;
  readonly disabledRules: Map<string, Set<Directive>>;
  readonly enabledRules: Set<string>;
}

function isSuppressed(directives: readonly Directive[], diagnostic: Diagnostic): boolean {
  let oneShot = false;
  const state: BlockState = { disableAll: new Set(), disabledRules: new Map(), enabledRules: new Set() };
  for (const directive of directives) {
    // A disable-line directive sits on the diagnostic's own line, so it is matched before the break.
    if (matchesOneShot(directive, diagnostic)) {
      directive.used = true;
      oneShot = true;
    }
    if (directive.line >= diagnostic.start.line) break;
    applyBlockDirective(state, directive);
  }
  const activeRuleDirectives = state.disabledRules.get(diagnostic.ruleId) ?? new Set<Directive>();
  const suppressedByBlanket = state.disableAll.size > 0 && !state.enabledRules.has(diagnostic.ruleId);
  if (suppressedByBlanket) markUsed(state.disableAll);
  markUsed(activeRuleDirectives);
  return oneShot || suppressedByBlanket || activeRuleDirectives.size > 0;
}

function matchesOneShot(directive: Directive, diagnostic: Diagnostic): boolean {
  const targetLine = directive.kind === "disable-next-line" ? directive.line + 1 : directive.kind === "disable-line" ? directive.line : undefined;
  return diagnostic.start.line === targetLine && matchesRules(directive, diagnostic.ruleId);
}

function applyBlockDirective(state: BlockState, directive: Directive): void {
  if (directive.kind === "disable-file" || directive.kind === "disable") applyDisable(state, directive);
  else if (directive.kind === "enable") applyEnable(state, directive);
}

function applyDisable(state: BlockState, directive: Directive): void {
  if (!directive.rules) {
    state.disableAll.add(directive);
    state.enabledRules.clear();
    return;
  }
  for (const rule of directive.rules) {
    const active = state.disabledRules.get(rule) ?? new Set<Directive>();
    active.add(directive);
    state.disabledRules.set(rule, active);
  }
}

function applyEnable(state: BlockState, directive: Directive): void {
  if (!directive.rules) {
    state.disableAll.clear();
    state.disabledRules.clear();
    state.enabledRules.clear();
    return;
  }
  for (const rule of directive.rules) {
    state.disabledRules.delete(rule);
    state.enabledRules.add(rule);
  }
}

function markUsed(directives: Iterable<Directive>): void {
  for (const directive of directives) directive.used = true;
}

function matchesRules(directive: Directive, ruleId: string): boolean {
  return directive.rules === null || directive.rules.includes(ruleId);
}
