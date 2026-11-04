import { createHash } from "node:crypto";

import type { Hash } from "node:crypto";

import type { DatabaseValue } from "@/backend/database/Database";

/** Row count and checksum of one table. */
export interface TableChecksum {
  readonly rows: number;
  readonly checksum: string;
}

/**
 * Feeds one value into the hash, in a form both databases give the same way.
 *
 * @remarks
 * The prefix keeps the values apart: `NULL` from an empty text and a number from
 * the text of its digits, and the length ends each value. A whole number has the
 * same digits as a `number` and as a `bigint`, and the facade reads a boolean as
 * `0` or `1`, like the source does.
 */
function addValue(hash: Hash, value: DatabaseValue): void {
  if (value === null) {
    hash.update("n;");
  } else if (Buffer.isBuffer(value)) {
    hash.update(`b${String(value.length)}:`);
    hash.update(value);
  } else if (typeof value === "string") {
    hash.update(`s${String(Buffer.byteLength(value))}:`);
    hash.update(value);
  } else {
    hash.update(`d${Object.is(value, -0) ? "-0" : String(value)};`);
  }
}

/**
 * Computes row count and checksum over all columns of a table.
 *
 * @param rows - The rows in the stable order of the table plan.
 * @returns The count and the SHA-256 in hexadecimal.
 */
export async function checksumRows(
  rows: AsyncIterable<readonly DatabaseValue[]>,
): Promise<TableChecksum> {
  const hash = createHash("sha256");
  let count = 0;
  for await (const row of rows) {
    for (const value of row) addValue(hash, value);
    count += 1;
  }
  return { rows: count, checksum: hash.digest("hex") };
}
