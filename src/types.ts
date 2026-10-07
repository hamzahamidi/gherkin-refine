import type {
  Background,
  Examples,
  Feature,
  GherkinDocument,
  Rule,
  Scenario,
  Step,
  Tag
} from "@cucumber/messages";

export type Severity = "off" | "warn" | "error";
export type SeverityInput = Severity | 0 | 1 | 2;
export type RuleSetting = SeverityInput | readonly [SeverityInput, unknown];
export type Position = Readonly<{ line: number; column: number }>;
export type SourceRange = readonly [number, number];

export interface RuleFix {
  readonly range: SourceRange;
  readonly text: string;
}

export interface RuleSuggestion {
  readonly description: string;
  readonly fix: RuleFix;
}

export interface Diagnostic {
  readonly filePath: string;
  readonly ruleId: string;
  readonly severity: Exclude<Severity, "off">;
  readonly message: string;
  readonly start: Position;
  readonly end?: Position;
  readonly range?: SourceRange;
  readonly messageId?: string;
  readonly fix?: RuleFix;
  readonly suggestions?: readonly RuleSuggestion[];
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface RuleMeta {
  readonly description: string;
  readonly category: "correctness" | "structure" | "naming" | "tags" | "formatting";
  readonly recommended: boolean;
  readonly fixable?: boolean;
  readonly hasSuggestions?: boolean;
  readonly documentation?: string;
  readonly defaultOptions?: unknown;
  readonly examples?: readonly string[];
}

export interface RuleContext<TOptions = unknown> {
  readonly document: LintDocument;
  readonly options: TOptions;
  readonly signal: AbortSignal;
  report(diagnostic: Omit<Diagnostic, "filePath" | "ruleId" | "severity">): void;
}

export interface RuleModule<TOptions = unknown> {
  readonly meta: RuleMeta;
  validateOptions?(options: unknown): options is TOptions;
  run(context: RuleContext<TOptions>): void | Promise<void>;
}

export interface RuleLocation {
  readonly feature: Feature;
  readonly rule?: Rule;
  readonly scenario?: Scenario;
  readonly examples?: Examples;
  readonly background?: Background;
  readonly step?: Step;
  readonly tag?: Tag;
}

export interface LintDocument {
  readonly filePath: string;
  readonly source: string;
  readonly lines: readonly string[];
  readonly ast: GherkinDocument;
  readonly feature?: Feature;
  readonly language: string;
  offsetAt(position: Position): number;
  positionAt(offset: number): Position;
  rangeForLine(line: number): SourceRange;
  textForRange(range: SourceRange): string;
}

export interface ConfigOverride {
  readonly files: string | readonly string[];
  readonly rules?: Readonly<Record<string, RuleSetting>>;
  readonly ignores?: readonly string[];
}

export interface LintConfig {
  readonly extends?: readonly string[];
  readonly rules?: Readonly<Record<string, RuleSetting>>;
  readonly overrides?: readonly ConfigOverride[];
  readonly ignores?: readonly string[];
  readonly plugins?: readonly string[];
  readonly reportUnusedDisableDirectives?: boolean;
  readonly maxConcurrency?: number;
  readonly maxFixPasses?: number;
}

export interface LintOptions {
  readonly cwd?: string;
  readonly filePath?: string;
  readonly config?: LintConfig;
  readonly configPath?: string;
  readonly signal?: AbortSignal;
  readonly fix?: boolean;
  readonly fixDryRun?: boolean;
  readonly reportUnusedDisableDirectives?: boolean;
  readonly maxDiagnostics?: number;
  readonly maxWarnings?: number;
  readonly absolutePaths?: boolean;
  readonly concurrency?: number;
}

export interface FileResult {
  readonly filePath: string;
  readonly diagnostics: readonly Diagnostic[];
  readonly fixes?: readonly RuleFix[];
  readonly output?: string;
}

export interface LintSummary {
  readonly files: number;
  readonly errors: number;
  readonly warnings: number;
  readonly fixable: number;
  readonly truncated: boolean;
}

export interface LintResult {
  readonly schemaVersion: 1;
  readonly tool: Readonly<{ name: "gherkinlint"; version: string }>;
  readonly summary: LintSummary;
  readonly results: readonly FileResult[];
}

export interface PluginModule {
  readonly rules?: Readonly<Record<string, RuleModule<unknown>>>;
  readonly projectRules?: Readonly<Record<string, ProjectRuleModule<unknown>>>;
  readonly configs?: Readonly<Record<string, LintConfig>>;
}

export interface ProjectRuleContext<TOptions = unknown> {
  readonly documents: readonly LintDocument[];
  readonly options: TOptions;
  readonly signal: AbortSignal;
  report(diagnostic: Diagnostic): void;
}

export interface ProjectRuleModule<TOptions = unknown> {
  readonly meta: RuleMeta;
  validateOptions?(options: unknown): options is TOptions;
  run(context: ProjectRuleContext<TOptions>): void | Promise<void>;
}

export interface LintTextOptions extends LintOptions {
  readonly config?: LintConfig;
}

export interface LintFilesOptions extends LintOptions {
  readonly config?: LintConfig;
  readonly concurrency?: number;
}

export type RuleVisitor<TNode> = (node: TNode, location: RuleLocation) => void;
