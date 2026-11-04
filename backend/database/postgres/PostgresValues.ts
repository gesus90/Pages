import type { TypeParsers } from "pg";

import type { DatabaseValue } from "../Database";

/** Column type numbers of the PostgreSQL catalog (`pg_type.oid`). */
const COLUMN_TYPE = {
  BOOLEAN: 16,
  BYTEA: 17,
  BIGINT: 20,
  SMALLINT: 21,
  INTEGER: 23,
  OID: 26,
  REAL: 700,
  DOUBLE_PRECISION: 701,
  NUMERIC: 1700,
} as const;

const WHOLE_NUMBER = /^-?\d+$/u;

/** A whole number stays a plain number while it fits, like a DuckDB `BIGINT`. */
function toWholeNumber(text: string): number | bigint {
  const number = Number(text);
  return Number.isSafeInteger(number) ? number : BigInt(text);
}

function toNumber(text: string): number | bigint {
  return WHOLE_NUMBER.test(text) ? toWholeNumber(text) : Number(text);
}

function toBooleanNumber(text: string): number {
  return text === "t" ? 1 : 0;
}

function toText(text: string): string {
  return text;
}

/**
 * Creates the parsers that map PostgreSQL columns to the row values of the facade.
 *
 * @param readBytes - The driver's parser for `bytea`, which honours the
 * output format of the server.
 * @returns Parsers for one connection pool; the global driver state stays untouched.
 *
 * @remarks
 * Repositories read what the DuckDB worker returns: a number or a `bigint`
 * beyond the safe range for whole numbers, the integers `0` and `1` for
 * booleans, a `Buffer` for binary data. `SUM` of a `BIGINT` is `NUMERIC` here,
 * so `NUMERIC` follows the same rule. Every other type stays the text
 * PostgreSQL sent, so a time, a JSON document or a list never becomes an
 * object a repository does not expect.
 */
export function createTypeParsers(
  readBytes: (text: string) => unknown,
): TypeParsers {
  const toBytes = (text: string): DatabaseValue => {
    const bytes = readBytes(text);
    if (!Buffer.isBuffer(bytes))
      throw new Error("Database returned a value of an unsupported type.");
    return bytes;
  };
  return {
    getTypeParser: (oid) => {
      switch (oid) {
        case COLUMN_TYPE.BOOLEAN:
          return toBooleanNumber;
        case COLUMN_TYPE.BYTEA:
          return toBytes;
        case COLUMN_TYPE.BIGINT:
          return toWholeNumber;
        case COLUMN_TYPE.SMALLINT:
        case COLUMN_TYPE.INTEGER:
        case COLUMN_TYPE.OID:
        case COLUMN_TYPE.REAL:
        case COLUMN_TYPE.DOUBLE_PRECISION:
          return Number;
        case COLUMN_TYPE.NUMERIC:
          return toNumber;
        default:
          return toText;
      }
    },
  };
}

/** The type number of `bytea`, whose parser the driver provides. */
export const BYTEA_COLUMN_TYPE = COLUMN_TYPE.BYTEA;
