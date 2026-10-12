import { chmod, mkdtemp, writeFile, rm, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [baseDir, branchDir, countArg = "1500", seedArg = "1"] = process.argv.slice(2);
if (!baseDir || !branchDir) {
  process.stderr.write("Usage: npm run differential -- <base dist> <candidate dist> [count] [seed]\n");
  process.exit(2);
}
const load = async (dir) => ({
  api: await import(pathToFileURL(resolve(dir, "index.js")).href),
  migrate: await import(pathToFileURL(resolve(dir, "compat/migrate.js")).href),
  version: JSON.parse(readFileSync(resolve(dir, "../package.json"), "utf8")).version
});
const base = await load(baseDir);
const branch = await load(branchDir);
const neutral = (value, version) => JSON.stringify(value).replaceAll(version, "<version>");
const same = (left, right) => neutral(left, base.version) === neutral(right, branch.version);

let state = Number(seedArg) >>> 0 || 1;
const rand = () => {
  state ^= state << 13; state >>>= 0;
  state ^= state >>> 17;
  state ^= state << 5; state >>>= 0;
  return state / 4294967296;
};
const pick = (items) => items[Math.floor(rand() * items.length)];
const chance = (p) => rand() < p;
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

const NAMES = ["login", "Login", "checkout flow", "apply coupon", "", "  padded  ", "<id> lookup", "Pay <amount> now", "duplicate", "Duplicate", "very long name that goes on and on beyond any sensible limit for a title"];
const TAGS = ["@smoke", "@wip", "@todo-1", "@Slow", "@smoke#x", "@a", "@b", "@JIRA-12", "@only"];
const STEP_TEXT = ["a user <name> exists", "I log in", "I see <result>", "the cart has 3 items", "nothing", "a value with trailing tab", "the \"quoted\" thing", "<undeclared> appears"];
const KEYWORDS = ["Given", "When", "Then", "And", "But", "*"];
const NBSP = String.fromCharCode(0xa0);
const BOM = String.fromCharCode(0xfeff);
const LS = String.fromCharCode(0x2028);
const SPACES = ["", " ", "  ", "\t", "   ", ` ${NBSP}`, `\t `, ` ${BOM}`];

function commentOnlyDoc() {
  const lines = Array.from({ length: int(0, 3) }, () => pick(["", "  ", "# note", `${NBSP}`, "#"]));
  lines.push(pick(["# language: fr", "#language:de-CH", "  #  language :  es", `${NBSP}# language: it`, "# language:", "x # language: fr", "#", " language: fr", `#${LS}language: nl`]));
  for (let i = 0, n = int(0, 2); i < n; i += 1) lines.push(pick(["# gherkin-refine-disable-file", "# language: ja", "", "#  -- reason"]));
  return lines.join(pick(["\n", "\r\n", "\r"])) + pick(["", "\n"]);
}

function tagLine(indent) {
  if (!chance(0.4)) return [];
  const tags = Array.from({ length: int(1, 3) }, () => pick(TAGS));
  let line = `${indent}${tags.join(chance(0.2) ? "  " : " ")}`;
  if (chance(0.15)) line += " # @commented";
  return [line];
}

function steps(indent, outline) {
  const lines = [];
  for (let i = 0, n = int(0, 6); i < n; i += 1) {
    lines.push(`${indent}${pick(KEYWORDS)} ${pick(STEP_TEXT)}${pick(SPACES)}`);
    if (chance(0.1)) lines.push(`${indent}  """`, `${indent}  doc <name> line${pick(SPACES)}`, "", `${indent}  """`);
    if (chance(0.1)) lines.push(`${indent}  | a | <b> |`, `${indent}  | 1 |  2  |`);
  }
  if (outline) {
    for (let e = 0, n = int(0, 3); e < n; e += 1) {
      lines.push(...tagLine(indent.slice(2)), `${indent.slice(2)}Examples:${chance(0.3) ? " named" : ""}`);
      const headers = [...new Set(Array.from({ length: int(1, 3) }, () => pick(["name", "result", "amount", "id", "b"])))];
      lines.push(`${indent}| ${headers.join(" | ")} |`);
      for (let r = 0, rows = int(0, 2); r < rows; r += 1) lines.push(`${indent}| ${headers.map(() => pick(["x", "y", ""])).join(" | ")} |`);
    }
  }
  return lines;
}

function scenario(indent) {
  const outline = chance(0.35);
  const lines = [...tagLine(indent), `${indent}${outline ? pick(["Scenario Outline", "Scenario Template"]) : pick(["Scenario", "Example"])}: ${pick(NAMES)}${pick(SPACES)}`];
  if (chance(0.1)) lines.push(`${indent}# gherkin-refine-${pick(["disable-next-line", "disable-line", "disable", "enable", "disable-file"])}${chance(0.5) ? ` ${pick(["no-trailing-whitespace", "no-dupe-scenario-names, indentation", "required-tags"])}` : ""}${chance(0.3) ? pick([" -- reason", " -- -- twice", " --  a -- b", "  --reason", ` --${NBSP}x`]) : ""}`);
  lines.push(...steps(`${indent}  `, outline));
  return lines;
}

function feature() {
  const lines = [];
  if (chance(0.1)) lines.push(pick(["# language: en", "#language:fr", "# language: en-lol"]));
  if (chance(0.05)) return [...lines, "Not gherkin at all", "  Scenario"].join("\n");
  if (chance(0.08)) return commentOnlyDoc();
  lines.push(...tagLine(""), `Feature: ${pick(NAMES)}${pick(SPACES)}`);
  if (chance(0.3)) lines.push("  Some description", "");
  if (chance(0.3)) lines.push(`${pick(SPACES)}Background:`, ...steps("    ", false));
  for (let i = 0, n = int(0, 4); i < n; i += 1) {
    if (chance(0.25)) lines.push("", "", "");
    if (chance(0.2)) lines.push(`  # comment ${pick(["gherkinlint-disable", "plain"])}`);
    lines.push(...scenario(pick(["  ", "    ", " ", ""])));
  }
  for (let r = 0, n = chance(0.5) ? int(1, 2) : 0; r < n; r += 1) {
    lines.push(...tagLine("  "), `  Rule: ${pick(NAMES)}`);
    if (chance(0.3)) lines.push("    Background:", ...steps("      ", false));
    for (let i = 0, m = int(0, 3); i < m; i += 1) lines.push(...scenario("    "));
  }
  const eol = pick(["\n", "\n", "\r\n", "\r"]);
  let source = lines.join(eol);
  source += pick(["", eol, eol + eol, eol + eol + eol]);
  return source;
}

const CANDIDATE_OPTIONS = [undefined, "yes", "no", { maxSteps: 3 }, { maxScenarios: 2 }, { max: 20 }, { pattern: "^@[a-z]" },
  { tags: ["@wip"], patterns: ["^@todo"] }, { tags: ["@smoke"] }, { scope: "anywhere" }, { Feature: 10, Scenario: 15 },
  { style: "kebab-case" }, { Feature: 0, Scenario: 2, Step: 4 }, ["@wip"], { tags: ["@smoke"], patterns: [] }];

async function enableable(api) {
  const ids = [...Object.keys(api.fileRules), ...Object.keys(api.projectRules)];
  const variants = [{}, {}];
  for (const id of ids) {
    const accepted = [];
    for (const options of CANDIDATE_OPTIONS) {
      const setting = options === undefined ? "error" : ["error", options];
      try {
        await api.lintText("Feature: x\n", { filePath: "a.feature", config: { extends: [], rules: { [id]: setting } } });
        accepted.push(setting);
      } catch { continue; }
    }
    if (accepted.length === 0) { console.error(`no options accepted for ${id}`); continue; }
    variants[0][id] = accepted[0];
    variants[1][id] = accepted.at(-1);
  }
  return variants;
}

const variants = await enableable(base.api);
const branchVariants = await enableable(branch.api);
if (!same(variants, branchVariants)) {
  console.log("DIFF in accepted options", JSON.stringify(variants), JSON.stringify(branchVariants));
  process.exitCode = 1;
}

async function settle(fn) {
  try { return { ok: await fn() }; } catch (error) { return { error: `${error?.name}: ${error?.message}` }; }
}

const FORMATS = ["stylish", "compact", "json", "ndjson", "sarif"];
async function runLintText(api, source, config, extra) {
  return settle(async () => {
    const result = await api.lintText(source, { filePath: "features/x.feature", config, ...extra });
    return [result, ...FORMATS.map((format) => api.formatResult(result, format, { cwd: "/repo", quiet: extra.quiet }))];
  });
}

const count = Number(countArg);
let diffs = 0;
const report = (kind, input, left, right) => {
  diffs += 1;
  if (diffs <= 5) console.log(`DIFF ${kind}\n--- input\n${JSON.stringify(input)}\n--- base\n${JSON.stringify(left).slice(0, 1500)}\n--- branch\n${JSON.stringify(right).slice(0, 1500)}`);
};

for (let i = 0; i < count; i += 1) {
  const source = feature();
  const config = { extends: [], rules: pick(variants), reportUnusedDisableDirectives: chance(0.5) };
  const extra = pick([{}, { fixDryRun: true }, { quiet: true }, { maxDiagnostics: int(0, 5) }, { reportUnusedDisableDirectives: true }]);
  const [left, right] = [await runLintText(base.api, source, config, extra), await runLintText(branch.api, source, config, extra)];
  if (!same(left, right)) report("lintText", { source, config, extra }, left, right);
}

for (let i = 0; i < Math.ceil(count / 5); i += 1) {
  const root = await mkdtemp(join(tmpdir(), "gr-diff-"));
  const outside = await mkdtemp(join(tmpdir(), "gr-out-"));
  try {
    const files = int(1, 5);
    for (let f = 0; f < files; f += 1) {
      const dir = join(root, pick(["", "a", "a/b", "node_modules", ".hidden"]));
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${pick(["one", "two", "Three", "four-x"])}${f}.feature`), chance(0.3) ? commentOnlyDoc() : feature());
    }
    const probe = join(root, "node_modules", "gherkin-refine-plugin-probe");
    await mkdir(probe, { recursive: true });
    await writeFile(join(probe, "package.json"), JSON.stringify({ name: "gherkin-refine-plugin-probe", type: "module", main: "index.js" }));
    await writeFile(join(probe, "index.js"), `export default { rules: { language: { meta: { description: "probe", category: "correctness", recommended: false }, run({ document, report }) { report({ message: "language " + document.language, start: { line: 1, column: 1 } }); } },
      walk: { meta: { description: "probe", category: "correctness", recommended: false }, run({ document, report }) {
        const api = globalThis.__walkApi; let order = 0;
        const emit = (kind) => (node, location) => report({ message: [String(order++).padStart(5, "0"), kind, node.location.line, node.location.column, node.name ?? node.text ?? "", Object.keys(location).join(","), location.rule?.name ?? "-", location.scenario?.name ?? "-", location.background ? "bg" : "-", location.examples?.name ?? "-"].join(" "), start: { line: 1, column: 1 } });
        api.forEachRule(document, emit("rule")); api.forEachScenario(document, emit("scenario")); api.forEachStep(document, emit("step"));
        api.forEachExamples(document, emit("examples")); api.forEachTag(document, emit("tag"));
      } } } };\n`);
    const config = { extends: [], plugins: ["gherkin-refine-plugin-probe"], rules: { ...pick(variants), "probe/language": "error", "probe/walk": "error" } };
    await mkdir(join(root, "a"), { recursive: true });
    await writeFile(join(root, "a", "base.feature"), feature());
    await writeFile(join(outside, "escaped.feature"), feature());
    await mkdir(join(outside, "sub"), { recursive: true });
    await writeFile(join(outside, "sub", "deep.feature"), feature());
    if (chance(0.7)) await symlink(join(root, "a", "base.feature"), join(root, "link.feature"));
    if (chance(0.7)) await symlink(join(root, "a"), join(root, "linkdir"));
    if (chance(0.5)) await symlink(join(root, "missing-target.feature"), join(root, "dead.feature"));
    if (chance(0.5)) await symlink(outside, join(root, "out"));
    if (chance(0.5)) await symlink(join(outside, "escaped.feature"), join(root, "a", "escaped-link.feature"));
    if (chance(0.3)) {
      await mkdir(join(root, "locked"), { recursive: true });
      await writeFile(join(root, "locked", "x.feature"), "Feature: locked\n");
      await chmod(join(root, "locked"), 0o000);
    }
    const inputs = pick([["."], ["a"], ["**/*.feature"], ["missing"], ["a/*.feature", "."], ["nomatch/*.feature"],
      ["link.feature"], ["linkdir"], ["linkdir/"], ["dead.feature"], ["out"], ["out", "a"], ["linkdir/*.feature"], ["locked/x.feature"],
      ["locked"], ["a", "linkdir", "link.feature"], ["./a/../link.feature"], ["a\\*.feature"], [join(root, "a")], ["*.feature"]]);
    const run = (api) => settle(async () => {
      globalThis.__walkApi = api;
      const result = await api.lintFiles(inputs, { cwd: root, config, fixDryRun: chance(0.5) });
      return [result, api.formatResult(result, "sarif", { cwd: root })];
    });
    const seed = state;
    const left = await run(base.api);
    state = seed;
    const right = await run(branch.api);
    if (!same(left, right)) report("lintFiles", { inputs }, left, right);
  } finally {
    await chmod(join(root, "locked"), 0o755).catch(() => {});
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
}

const LEGACY_KEYS = ["no-trailing-spaces", "indentation", "name-length", "no-unused-variables", "required-tags", "max-scenarios-per-file", "file-name", "toString", "allowed-tags"];
for (let i = 0; i < count; i += 1) {
  const entries = Array.from({ length: int(0, 4) }, () => `${pick(["", "// c\n", "/* b */"])}"${pick(LEGACY_KEYS)}": ${pick(['"on"', '"off"', '["on", {"Feature": 3}]', '["on", {"tags": ["@a"]}]', '"o\\"n"', '"a // not comment"'])}`);
  const source = `${pick(["", "// head\n", "/* x */"])}{${entries.join(pick([",", ",\n"]))}}${pick(["", "\n// tail", "/* open"])}`;
  const run = (m) => settle(async () => m.migrateLegacyConfig(m.parseLegacyConfig(source)));
  const [left, right] = [await run(base.migrate), await run(branch.migrate)];
  if (!same(left, right)) report("migrate", { source }, left, right);
}

console.log(`${diffs} difference(s) over ${count} lintText, ${Math.ceil(count / 5)} lintFiles and ${count} migration inputs (seed ${seedArg})`);
if (diffs > 0) process.exitCode = 1;
