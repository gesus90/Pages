import { randomUUID } from "node:crypto";

import { parameterUses } from "./PostgresParameterUse";
import { textWithoutNul } from "./PostgresText";

import type { ParameterUse } from "./PostgresParameterUse";
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
  readonly uses: ReadonlyMap<string, ParameterUse>;
}

/** A statement ready for the driver. */
export interface BoundStatement {
  readonly text: string;
  readonly values: readonly PostgresBoundValue[];
  /** U+0000 characters taken out of written values; this number is all a log may say about them. */
  readonly removedNulCharacters: number;
  /** What stands in for compared values with U+0000; a result must not hold any of them. */
  readonly comparisonStandIns: readonly string[];
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
  const translation = { text, names, uses: parameterUses(statement) };
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
 * The value for a text with U+0000, by what the statement does with it.
 *
 * @remarks
 * No stored text holds the character on PostgreSQL, so a compared value equals none:
 * a stand-in no row can hold gives the result of a value that is not found, with the
 * counts and the `<>` of such a value. A text that goes out as it is makes PostgreSQL
 * refuse the statement with 22021 and no content, which also ends an open transaction.
 */
function textWithNulFor(text: string, use: ParameterUse | undefined): string {
  if (use === "written") return textWithoutNul(text) ?? text;
  if (use === "compared") return `no-stored-text-${randomUUID()}`;
  return text;
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
 *
 * @remarks
 * Only a value that `parameterUses` knows as written loses U+0000. See
 * {@link textWithNulFor} for all others.
 */
export function bindStatement(
  statement: string,
  parameters: SqlParameters,
): BoundStatement {
  const { text, names, uses } = translate(statement);
  for (const name of Object.keys(parameters))
    if (!names.includes(name))
      throw new Error(`The statement has no parameter "${name}".`);
  let removedNulCharacters = 0;
  const comparisonStandIns: string[] = [];
  const values = names.map((name) => {
    const value = parameters[name];
    if (value === undefined)
      throw new Error(`The statement needs a value for "${name}".`);
    if (typeof value !== "string" || !value.includes("\u0000"))
      return toBoundValue(value);
    const bound = textWithNulFor(value, uses.get(name));
    if (uses.get(name) === "written")
      removedNulCharacters += value.length - bound.length;
    if (uses.get(name) === "compared") comparisonStandIns.push(bound);
    return bound;
  });
  return { text, values, removedNulCharacters, comparisonStandIns };
}
