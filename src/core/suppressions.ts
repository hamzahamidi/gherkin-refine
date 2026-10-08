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

function isSuppressed(directives: readonly Directive[], diagnostic: Diagnostic): boolean {
  let oneShot = false;
  const disableAll = new Set<Directive>();
  const disabledRules = new Map<string, Set<Directive>>();
  for (const directive of directives) {
    if (directive.kind === "disable-next-line" && diagnostic.start.line === directive.line + 1 && matchesRules(directive, diagnostic.ruleId)) {
      directive.used = true;
      oneShot = true;
    } else if (directive.kind === "disable-line" && diagnostic.start.line === directive.line && matchesRules(directive, diagnostic.ruleId)) {
      directive.used = true;
      oneShot = true;
    }
    if (directive.line >= diagnostic.start.line) break;
    if (directive.kind === "disable-file" || directive.kind === "disable") {
      if (!directive.rules) {
        disableAll.add(directive);
      } else {
        for (const rule of directive.rules) {
          const active = disabledRules.get(rule) ?? new Set<Directive>();
          active.add(directive);
          disabledRules.set(rule, active);
        }
      }
    } else if (directive.kind === "enable") {
      if (!directive.rules) {
        disableAll.clear();
        disabledRules.clear();
      } else {
        for (const rule of directive.rules) disabledRules.delete(rule);
      }
    }
  }
  const activeRuleDirectives = disabledRules.get(diagnostic.ruleId);
  const suppressed = oneShot || disableAll.size > 0 || Boolean(activeRuleDirectives?.size);
  if (suppressed) {
    for (const directive of disableAll) directive.used = true;
    for (const directive of activeRuleDirectives ?? []) directive.used = true;
  }
  return suppressed;
}

function matchesRules(directive: Directive, ruleId: string): boolean {
  return directive.rules === null || directive.rules.includes(ruleId);
}
