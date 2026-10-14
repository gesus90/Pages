import jsdoc from "eslint-plugin-jsdoc";
import globals from "globals";
import tseslint from "typescript-eslint";

import {
  typescriptRules,
  sizeRules,
  cleanCodeRules,
  documentationRules,
} from "../eslint.rules.js";

/** Standalone MCP rules with package-local type information and dependencies. */
export default tseslint.config(
  { ignores: ["**/dist/**", "**/coverage/**", "**/node_modules/**"] },
  { linterOptions: { noInlineConfig: true } },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,ts}"],
    languageOptions: { globals: globals.node },
    rules: sizeRules,
  },
  {
    files: ["**/*.ts"],
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
);
