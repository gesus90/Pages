import { createInClause } from "@/backend/database/repositories/task/InClause";

import type { InClause } from "@/backend/database/repositories/task/InClause";

/**
 * Builds the placeholders of an `IN (...)` list that may be empty.
 *
 * @param prefix - Prefix of the placeholder names.
 * @param values - The values; an empty list matches nothing.
 * @returns Placeholders and their values; `NULL` stands for an empty list,
 * which no `IN` comparison matches.
 */
export function calendarInList(
  prefix: string,
  values: readonly string[],
): InClause {
  if (values.length === 0) return { placeholders: "NULL", parameters: {} };
  return createInClause(prefix, values);
}
