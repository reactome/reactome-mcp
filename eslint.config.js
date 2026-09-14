// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "web/**", "coverage/**"],
  },
  js.configs.recommended,

  // Type-aware linting. It costs a slower run and buys rules that a purely
  // syntactic pass cannot have: an unawaited promise in a tool handler returns
  // an empty result to the model rather than failing, which is exactly the kind
  // of quiet wrongness this repo has already shipped once.
  ...tseslint.configs.recommendedTypeChecked,
  {
    // Scoped to TypeScript: the type-aware parser needs every file it sees to
    // be in the program, and the plain-JS files below are not.
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.eslint.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // The Reactome services return a lot of loosely-typed JSON, and the
      // honest local type for a field we have not pinned down is `any`. Warn
      // so it stays visible, but do not fail the build over it -- the real
      // guard against bad shapes is a fixture test, not a lint rule.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",

      // These are errors: each one is a silent-wrongness bug, not a style
      // preference.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",

      // Off by decision: MCP tool handlers are declared async uniformly so
      // that every tool in a file has the same signature, whether or not it
      // happens to await. A handler that is sync today often is not tomorrow.
      "@typescript-eslint/require-await": "off",

      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  // Tests deliberately hand malformed payloads to the formatters, so the
  // unsafe-* rules have nothing useful to say about them.
  {
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-explicit-any": "off",
      // vi.fn().mockImplementation(async ...) is the idiom for stubbing an
      // async dependency; the mock's declared type does not carry that.
      "@typescript-eslint/no-misused-promises": "off",
    },
  },

  // Plain JavaScript -- eslint.config.js and the smoke scripts under scripts/
  // are not in the TypeScript program, so the type-aware parser cannot read
  // them.
  {
    files: ["**/*.js", "**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      parserOptions: { project: false, projectService: false },
      globals: {
        console: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        URL: "readonly",
        fetch: "readonly",
      },
    },
  },

  // Must stay last: turns off everything Prettier owns.
  prettier
);
