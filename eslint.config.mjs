import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/playwright-report/**", "**/test-results/**", "**/next-env.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "no-restricted-syntax": [
        "error",
        {
          // R6: status values change only through domain/state transition functions.
          selector: "TemplateLiteral[quasis.0.value.raw=/set\\s+status\\s*=/i]",
          message: "Use the transition functions in domain/state (R6).",
        },
      ],
    },
  },
  {
    // R2: the domain layer is framework-free — no database, HTTP or framework imports.
    files: ["packages/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["pg", "pg-*", "drizzle-orm", "drizzle-orm/*", "next", "next/*", "react", "@verilo/*", "node:http", "node:https", "node:net", "zod"], message: "domain/ must stay framework-free (R2)." },
          ],
        },
      ],
    },
  },
  {
    // R3: tenant tables are reached only through the firm-scoped repository in packages/db.
    files: ["apps/**/*.ts", "apps/**/*.tsx"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": ["error", { paths: [{ name: "drizzle-orm", message: "Use @verilo/db repository functions (R3)." }] }],
    },
  },
  {
    files: ["infra/images/**/*.mjs", "scripts/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
);
