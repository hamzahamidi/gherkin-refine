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
        statements: 68,
        branches: 50,
        functions: 70,
        lines: 70
      }
    }
  }
});
