import jsdoc from "eslint-plugin-jsdoc";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

import {
  typescriptRules,
  sizeRules,
  cleanCodeRules,
  documentationRules,
} from "./eslint.rules.js";

/** Source files whose rules need type information from `tsconfig.json`. */
const typedSourceFiles = [
  "app/**/*.{ts,tsx}",
  "backend/**/*.ts",
  "definition/**/*.ts",
  "language/**/*.ts",
  "tests/**/*.{ts,tsx}",
  "vitest.*.config.ts",
  "mcp/src/**/*.ts",
  "mcp/scripts/**/*.ts",
  "mcp/tests/**/*.ts",
];

/** ESLint flat configuration for Pages. */
export default tseslint.config(
  {
    ignores: ["build/**", "**/coverage/**", ".react-router/**", "**/dist/**"],
  },
  {
    // Rules cannot be switched off with `eslint-disable` comments.
    linterOptions: { noInlineConfig: true },
    languageOptions: {
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
  },
  ...tseslint.configs.recommended,
  {
    files: ["app/**/*.{ts,tsx}", "tests/frontend/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: [
      "backend/**/*.ts",
      "definition/**/*.ts",
      "language/**/*.ts",
      "tests/backend/**/*.{ts,tsx}",
      "mcp/**/*.ts",
      "*.config.{js,mjs,ts}",
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // GUIDELINES.md rules that the source already satisfies. They are errors
    // so that the current state cannot regress.
    files: typedSourceFiles,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: typescriptRules,
  },
  {
    // Size and complexity limits of GUIDELINES.md ("huge functions", "huge
    // classes", "deep nesting").
    files: typedSourceFiles,
    rules: sizeRules,
  },
  {
    // Clean-code rules of GUIDELINES.md chapters 2, 4, 6, 10, 11 and 16.
    files: typedSourceFiles,
    rules: cleanCodeRules,
  },
  {
    // Rules of hooks and effect dependencies (GUIDELINES.md chapter 12).
    files: ["app/**/*.{ts,tsx}", "tests/frontend/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/rules-of-hooks": "error",
    },
  },
  {
    // TypeDoc comments of GUIDELINES.md chapter 7.
    files: typedSourceFiles,
    plugins: { jsdoc },
    rules: documentationRules,
  },
);
