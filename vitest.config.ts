import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/cli.ts"],
      reporter: ["text", "text-summary", "lcov", "html"],
      reportsDirectory: "./coverage",
      thresholds: {
        statements: 97,
        branches: 90,
        functions: 97,
        lines: 98
      }
    }
  }
});
