import jsdoc from "eslint-plugin-jsdoc";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

import {
  typescriptRules,
  sizeRules,
  cleanCodeRules,
  documentationRules,
  themeColorRules,
} from "./eslint.rules.mjs";

/** Source files whose rules need type information from `tsconfig.json`. */
const typedSourceFiles = [
  "app/**/*.{ts,tsx}",
  "src/**/*.{ts,tsx}",
  "tests/**/*.{ts,tsx}",
  "app.config.ts",
  "jest.setup.ts",
];

/** ESLint flat configuration for Pica Mobile; the rules are those of Pages. */
export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "coverage/**",
      ".expo/**",
      "android/**",
      "ios/**",
      "node_modules/**",
    ],
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
    files: ["**/*.{js,mjs,ts,tsx}"],
    languageOptions: { globals: { ...globals.node, __DEV__: "readonly" } },
    rules: sizeRules,
  },
  {
    files: typedSourceFiles,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { jsdoc },
    rules: {
      ...typescriptRules,
      ...cleanCodeRules,
      ...documentationRules,
    },
  },
  {
    // Rules of hooks and effect dependencies (GUIDELINES.md chapter 12).
    files: ["app/**/*.{ts,tsx}", "src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/rules-of-hooks": "error",
    },
  },
  {
    files: ["app/**/*.{ts,tsx}", "src/**/*.{ts,tsx}"],
    ignores: ["src/theme/tokens.ts"],
    rules: themeColorRules,
  },
);
