import { TransferRefusal } from "./transfer-refusal";

import type { DatabaseValue } from "@/backend/database/Database";
import type { TablePlan } from "./table-plan";

/** The one character PostgreSQL cannot store in text. */
const NUL = "\u0000";

/** A backslash with what it escapes in JSON; other backslashes make no difference here. */
const JSON_ESCAPE = /\\(?:u[0-9a-fA-F]{4}|[\s\S])/gu;

/** What the removal changed in one column of one table: numbers, no content. */
export interface RemovedNulColumn {
  readonly table: string;
  readonly column: string;
  values: number;
  characters: number;
}

/** The numbers of a run, by table and column. */
export type RemovedNulCounts = Map<string, RemovedNulColumn>;

function escapesOf(text: string): readonly string[] {
  return (text.match(JSON_ESCAPE) ?? []).filter(
    (escape) => !escape.includes(NUL),
  );
}

function hasSameEscapes(first: string, second: string): boolean {
  const firstEscapes = escapesOf(first);
  const secondEscapes = escapesOf(second);
  return (
    firstEscapes.length === secondEscapes.length &&
    firstEscapes.every((escape, index) => escape === secondEscapes[index])
  );
}

function removeFromText(
  plan: TablePlan,
  columnIndex: number,
  text: string,
  counts: RemovedNulCounts,
): string {
  const cleaned = text.replaceAll(NUL, "");
  const column = plan.columns[columnIndex] ?? String(columnIndex);
  if (!hasSameEscapes(text, cleaned))
    throw new TransferRefusal(
      `Removing U+0000 from a value of ${plan.name}.${column} would create or remove a JSON escape. Nothing of this table was kept. Correct that value in the source first.`,
    );
  const key = `${plan.name}.${column}`;
  const known = counts.get(key);
  const entry = known ?? { table: plan.name, column, values: 0, characters: 0 };
  entry.values += 1;
  entry.characters += text.length - cleaned.length;
  counts.set(key, entry);
  return cleaned;
}

/**
 * Turns the rows of the source into what the target has to hold.
 *
 * @param plan - The table.
 * @param rows - The rows of the source.
 * @param counts - Receives the changed values. The copy leaves it out, because
 * the check reads the same file again and reports them.
 * @yields The rows without U+0000 in text; binary values and everything else stay.
 * @throws {TransferRefusal} When the removal would create or remove a JSON escape,
 * as in a backslash, the character and `u0000`.
 */
export async function* cleanRows(
  plan: TablePlan,
  rows: AsyncIterable<readonly DatabaseValue[]>,
  counts: RemovedNulCounts = new Map(),
): AsyncGenerator<readonly DatabaseValue[]> {
  for await (const row of rows)
    yield row.map((value, index) =>
      typeof value === "string" && value.includes(NUL)
        ? removeFromText(plan, index, value, counts)
        : value,
    );
}
