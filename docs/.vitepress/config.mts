import { readdirSync } from "node:fs";
import { defineConfig } from "vitepress";

const ruleIds = readdirSync(new URL("../rules", import.meta.url))
  .filter((name) => name.endsWith(".md"))
  .map((name) => name.slice(0, -".md".length))
  .sort();

export default defineConfig({
  title: "Gherkin Refine",
  description: "A fast, deterministic Gherkin linter and safe fixer for Node.js, CI, and AI coding agents.",
  base: "/gherkin-refine/",
  cleanUrls: true,
  lastUpdated: true,
  sitemap: { hostname: "https://hamidihamza.com/gherkin-refine/" },
  themeConfig: {
    nav: [
      { text: "Guide", link: "/getting-started" },
      { text: "Rules", link: "/rules" },
      { text: "Migrate from gherkin-lint", link: "/migration" },
      { text: "Changelog", link: "https://github.com/hamzahamidi/gherkin-refine/blob/main/CHANGELOG.md" }
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting started", link: "/getting-started" },
          { text: "Configuration", link: "/configuration" },
          { text: "Plugins", link: "/plugins" },
          { text: "Migrate from gherkin-lint", link: "/migration" },
          { text: "AI agent integration", link: "/agent-integration" }
        ]
      },
      {
        text: "Rules",
        items: [{ text: "Overview", link: "/rules" }, ...ruleIds.map((id) => ({ text: id, link: `/rules/${id}` }))]
      },
      {
        text: "Technical notes",
        collapsed: true,
        items: [
          { text: "Architecture", link: "/architecture" },
          { text: "Performance", link: "/performance" }
        ]
      }
    ],
    search: { provider: "local" },
    socialLinks: [
      { icon: "github", link: "https://github.com/hamzahamidi/gherkin-refine" },
      { icon: "npm", link: "https://www.npmjs.com/package/gherkin-refine" }
    ],
    editLink: {
      pattern: ({ filePath }) => `https://github.com/hamzahamidi/gherkin-refine/edit/main/docs/${filePath.startsWith("rules/") ? "rules.md" : filePath}`
    },
    footer: { message: "Released under the MIT License." }
  }
});
