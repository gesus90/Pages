import type { SqlParameters } from "../Database";

/** Most translated statements kept; repositories own a few hundred. */
const MAX_STATEMENTS = 2048;

/**
 * Everything of a statement that may hold a `$` without being a placeholder,
 * then the named placeholder itself: string literals with and without
 * backslash escapes, quoted identifiers, comments and dollar-quoted text.
 *
 * Nested block comments are the one form this does not follow; a placeholder
 * inside one fails loudly as a missing value, and repositories have none.
 */
const STATEMENT_TOKEN =
  /(?<![\w$])[eE]'(?:[^'\\]|\\.|'')*'|'(?:[^']|'')*'|"(?:[^"]|"")*"|--[^\n]*|\/\*.*?\*\/|\$(?<tag>[A-Za-z_]\w*)?\$.*?\$\k<tag>\$|(?<![\w$])\$(?<name>[A-Za-z_]\w*)/gsu;

/** A value as the driver sends it. */
export type PostgresBoundValue = string | number | bigint | Buffer | null;

/** A statement in PostgreSQL form with the names behind `$1`, `$2`, … */
interface TranslatedStatement {
  readonly text: string;
  readonly names: readonly string[];
}

/** A statement ready for the driver. */
export interface BoundStatement {
  readonly text: string;
  readonly values: readonly PostgresBoundValue[];
}

const translations = new Map<string, TranslatedStatement>();

function translate(statement: string): TranslatedStatement {
  const known = translations.get(statement);
  if (known !== undefined) return known;
  const names: string[] = [];
  const text = statement.replace(
    STATEMENT_TOKEN,
    (token: string, ...rest: unknown[]) => {
      const name = placeholderName(rest.at(-1));
      if (name === undefined) return token;
      if (!names.includes(name)) names.push(name);
      return `$${String(names.indexOf(name) + 1)}`;
    },
  );
  const translation = { text, names };
  if (translations.size < MAX_STATEMENTS)
    translations.set(statement, translation);
  return translation;
}

function placeholderName(groups: unknown): string | undefined {
  if (typeof groups !== "object" || groups === null) return undefined;
  const name: unknown = Object.getOwnPropertyDescriptor(groups, "name")?.value;
  return typeof name === "string" ? name : undefined;
}

function toBoundValue(value: SqlParameters[string]): PostgresBoundValue {
  // Boolean columns hold the integers 0 and 1, see `RowValue.ts`.
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

/**
 * Translates the named placeholders of a repository statement into `$1`, `$2`, …
 *
 * @param statement - SQL owned by a repository, with `$name` placeholders.
 * @param parameters - The named values.
 * @returns The statement with its values in placeholder order. A name used
 * twice stays one value.
 * @throws When a placeholder has no value or a value has no placeholder. The
 * message names the parameter, never a value.
 */
export function bindStatement(
  statement: string,
  parameters: SqlParameters,
): BoundStatement {
  const { text, names } = translate(statement);
  for (const name of Object.keys(parameters))
    if (!names.includes(name))
      throw new Error(`The statement has no parameter "${name}".`);
  const values = names.map((name) => {
    const value = parameters[name];
    if (value === undefined)
      throw new Error(`The statement needs a value for "${name}".`);
    return toBoundValue(value);
  });
  return { text, values };
}
