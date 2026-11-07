/** A value in a canonical form: object keys sorted, absent and `undefined` fields alike. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([key, entry]) => [key, canonical(entry)]),
  );
}

/**
 * Whether two plan values hold the same data, whatever the order of their keys.
 *
 * @param first - A stored or read value.
 * @param second - The value to compare it with.
 *
 * @remarks
 * A field set to `undefined` counts as absent, as it does once the plan is
 * stored as JSON.
 */
export function isSamePlanValue(first: unknown, second: unknown): boolean {
  return JSON.stringify(canonical(first)) === JSON.stringify(canonical(second));
}
