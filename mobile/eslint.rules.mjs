// Derived from `eslint.rules.js` of Pages, so the mobile app follows the same
// GUIDELINES.md rules. The SQL rule is left out because the app has no SQL; the
// color rule is added because components take colors from the theme tokens.

/** Shared TypeScript contract and async rules from GUIDELINES.md. */
export const typescriptRules = {
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
};

/** Shared function and file limits from GUIDELINES.md. */
export const sizeRules = {
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
};

/** Shared naming, type safety and control-flow rules from GUIDELINES.md. */
export const cleanCodeRules = {
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
};

/** Shared TypeDoc rules from GUIDELINES.md. */
export const documentationRules = {
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
};

/** Colors come from the theme tokens, never from a literal in a component. */
export const themeColorRules = {
  "no-restricted-syntax": [
    "error",
    {
      selector:
        "Literal[value=/^#[0-9a-fA-F]{3,8}$/], Literal[value=/^(rgb|hsl)a?\\(/]",
      message: "Take the color from the theme tokens in `src/theme/tokens.ts`.",
    },
  ],
};
