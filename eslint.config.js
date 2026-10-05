import jsdoc from "eslint-plugin-jsdoc";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

/** Source files whose rules need type information from `tsconfig.json`. */
const typedSourceFiles = [
  "app/**/*.{ts,tsx}",
  "backend/**/*.ts",
  "definition/**/*.ts",
  "language/**/*.ts",
];

/** ESLint flat configuration for Pages. */
export default tseslint.config(
  {
    ignores: ["build/**", "coverage/**", ".react-router/**", "dist/**"],
  },
  {
    // Rules cannot be switched off with `eslint-disable` comments.
    linterOptions: { noInlineConfig: true },
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
    rules: {
      "@typescript-eslint/consistent-type-definitions": ["error", "interface"],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/explicit-member-accessibility": [
        "error",
        { accessibility: "explicit" },
      ],
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/prefer-readonly": "error",
      "@typescript-eslint/use-unknown-in-catch-callback-variable": "error",
    },
  },
  {
    // Size and complexity limits of GUIDELINES.md ("huge functions", "huge
    // classes", "deep nesting").
    files: typedSourceFiles,
    rules: {
      complexity: ["error", 15],
      "max-depth": ["error", 3],
      "max-lines": [
        "error",
        { max: 600, skipBlankLines: true, skipComments: true },
      ],
      "max-lines-per-function": [
        "error",
        { max: 100, skipBlankLines: true, skipComments: true },
      ],
      "max-params": ["error", 4],
    },
  },
  {
    // Clean-code rules of GUIDELINES.md chapters 2, 4, 6, 10, 11 and 16.
    files: typedSourceFiles,
    rules: {
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        { assertionStyle: "as", objectLiteralTypeAssertions: "never" },
      ],
      "@typescript-eslint/explicit-function-return-type": [
        "error",
        { allowExpressions: true, allowTypedFunctionExpressions: true },
      ],
      "@typescript-eslint/member-ordering": [
        "error",
        {
          default: [
            "static-field",
            "instance-field",
            "constructor",
            "public-method",
            "protected-method",
            "private-method",
          ],
        },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-shadow": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/prefer-nullish-coalescing": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "no-console": ["error", { allow: ["debug", "info", "warn", "error"] }],
      "no-empty": "error",
      "@typescript-eslint/naming-convention": [
        "error",
        {
          selector: ["variable", "function", "parameter"],
          format: ["camelCase", "UPPER_CASE", "PascalCase"],
          // Vague names of GUIDELINES.md chapter 2.
          custom: {
            regex: "^(data|flag|helper|obj|stuff|tmp|value1)$",
            match: false,
          },
        },
        {
          // `_` marks a parameter that is deliberately not used.
          selector: "parameter",
          format: null,
          filter: { regex: "^_$", match: true },
        },
        { selector: "typeLike", format: ["PascalCase"] },
        { selector: "classMethod", format: ["camelCase"] },
        { selector: "classProperty", format: ["camelCase", "UPPER_CASE"] },
      ],
      "no-nested-ternary": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "Literal[value=/\\bSELECT\\s+\\*/i], TemplateElement[value.raw=/\\bSELECT\\s+\\*/i]",
          message: "Select explicit columns instead of `SELECT *`.",
        },
      ],
    },
  },
  {
    // Rules of hooks and effect dependencies (GUIDELINES.md chapter 12).
    files: ["app/**/*.{ts,tsx}"],
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
    rules: {
      "jsdoc/check-param-names": ["error", { checkDestructured: false }],
      "jsdoc/no-types": "error",
      "jsdoc/require-jsdoc": [
        "error",
        {
          contexts: [
            "ExportNamedDeclaration > FunctionDeclaration",
            "ExportDefaultDeclaration > FunctionDeclaration",
            "ExportNamedDeclaration > ClassDeclaration",
            "MethodDefinition[accessibility='public'][kind='method']",
          ],
          require: { FunctionDeclaration: false },
        },
      ],
    },
  },
);
