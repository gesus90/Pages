import { readBooleanColumn } from "@/backend/database/RowValue";
import { textWithoutNul } from "@/backend/database/postgres/PostgresText";

import type { DatabaseTransaction } from "@/backend/database/Database";

/**
 * Returns the text as this database would store it.
 *
 * @param database - The open database or transaction.
 * @param text - A text about to be saved.
 * @returns The text without U+0000 on a database that removes it, otherwise the text.
 *
 * @remarks
 * Only for telling whether a save would change what is stored. The value to save stays
 * the original, so that its removal is counted, and a read or a comparison of an identity
 * never uses this form.
 */
export async function storedTextForm(
  database: Pick<DatabaseTransaction, "query">,
  text: string,
): Promise<string> {
  if (!text.includes("\u0000")) return text;
  const [row = []] = await database.query("SELECT removes_nul_on_save();");
  return readBooleanColumn(row, 0, "removes_nul_on_save")
    ? (textWithoutNul(text) ?? text)
    : text;
}
