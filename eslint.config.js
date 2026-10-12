import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: globals.node } },
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }]
    }
  },
  {
    files: ["src/rules/**/*.ts"],
    rules: {
      "no-restricted-syntax": ["error", {
        selector: "TSAsExpression[expression.name='options']",
        message: "Type options through validateOptions and defineRule instead of a cast."
      }]
    }
  },
  {
    ignores: ["dist/**", "node_modules/**", "docs/.vitepress/cache/**", "docs/.vitepress/dist/**"]
  }
);
