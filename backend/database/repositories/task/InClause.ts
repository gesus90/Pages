/** Named placeholders of an `IN (...)` list together with the values they bind. */
export interface InClause {
  readonly placeholders: string;
  readonly parameters: Readonly<Record<string, string>>;
}

/**
 * Builds the named placeholders for an `IN (...)` list.
 *
 * @param prefix - Prefix of the placeholder names; the position is appended.
 * @param values - Values to bind, one placeholder each.
 * @returns The comma-separated placeholders and the parameters binding them.
 */
export function createInClause(
  prefix: string,
  values: readonly string[],
): InClause {
  const placeholders = values
    .map((_, index) => `$${prefix}_${index}`)
    .join(", ");
  const parameters = Object.fromEntries(
    values.map((value, index): [string, string] => [
      `${prefix}_${index}`,
      value,
    ]),
  );

  return { parameters, placeholders };
}
