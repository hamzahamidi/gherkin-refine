import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const docs = join(root, "docs");
const site = "https://hamidihamza.com/gherkin-refine";
const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

const guides = [
  ["getting-started", "Getting started", "Install, configure, fix, and run in GitHub Actions"],
  ["migration", "Migrate from gherkin-lint", "Drop-in replacement scope, rule mapping, and CLI flags"],
  ["configuration", "Configuration", "Config files, presets, overrides, ignores, and inline suppression"],
  ["rules", "Rules", "Every built-in rule with defaults and options"],
  ["plugins", "Plugins", "Writing and loading custom rules"],
  ["agent-integration", "AI agent integration", "JSON output, exit codes, and a remediation loop"]
];

const ruleFiles = (await readdir(join(docs, "rules"))).filter((name) => name.endsWith(".md")).sort();

const index = [
  "# Gherkin Refine",
  "",
  "> Gherkin and Cucumber linter for Node.js. Supports all 31 gherkin-lint 4.2.4 rules, installs the same `gherkin-lint` command, reads `.gherkin-lintrc`, and adds safe autofixes, plugins, and JSON, NDJSON, and SARIF output.",
  "",
  `npm package: \`gherkin-refine\` (version ${version}). Requires Node.js 22.18 or later. ESM only. MIT licensed.`,
  "",
  "Install with `npm install --save-dev gherkin-refine` and lint with `npx gherkin-refine .`. For automated consumers, use `--format json`. Not every gherkin-lint behavior is identical: `xunit` output is unavailable and custom `--rulesdir` rules need porting to a plugin.",
  "",
  "## Docs",
  "",
  ...guides.map(([page, title, summary]) => `- [${title}](${site}/${page}): ${summary}`),
  `- [Full documentation in one file](${site}/llms-full.txt)`,
  "",
  "## Rules",
  "",
  ...ruleFiles.map((name) => `- [${name.slice(0, -3)}](${site}/rules/${name.slice(0, -3)})`),
  "",
  "## Optional",
  "",
  "- [npm package](https://www.npmjs.com/package/gherkin-refine)",
  "- [Source code](https://github.com/hamzahamidi/gherkin-refine)",
  "- [JSON result schema](https://github.com/hamzahamidi/gherkin-refine/blob/main/schemas/result.schema.json)",
  "- [Changelog](https://github.com/hamzahamidi/gherkin-refine/blob/main/CHANGELOG.md)",
  ""
].join("\n");

const stripFrontmatter = (text) => text.replace(/^---\n[\s\S]*?\n---\n/, "").replace(/^<!--[\s\S]*?-->\n+/, "");
const sections = [];
for (const [page] of guides) {
  sections.push(`<!-- ${site}/${page} -->\n\n${stripFrontmatter(await readFile(join(docs, `${page}.md`), "utf8")).trim()}`);
  if (page === "rules") {
    for (const name of ruleFiles) sections.push(stripFrontmatter(await readFile(join(docs, "rules", name), "utf8")).trim().replace(/^# /, "## "));
  }
}
const full = `${index.split("\n## Docs")[0].trim()}\n\n${sections.join("\n\n")}\n`;

await mkdir(join(docs, "public"), { recursive: true });
await writeFile(join(docs, "public", "llms.txt"), index);
await writeFile(join(docs, "public", "llms-full.txt"), full);
console.log(`Wrote docs/public/llms.txt and llms-full.txt (${full.length} characters).`);
