import globals from "globals";
import tseslint from "typescript-eslint";

/** ESLint flat configuration for Pages. */
export default tseslint.config(
  {
    ignores: ["build/**", "coverage/**", ".react-router/**", "dist/**"],
  },
  ...tseslint.configs.recommended,
  {
    files: ["app/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: [
      "backend/**/*.ts",
      "definition/**/*.ts",
      "language/**/*.ts",
      "tests/**/*.ts",
      "tests/**/*.tsx",
      "*.config.{js,mjs,ts}",
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
);
