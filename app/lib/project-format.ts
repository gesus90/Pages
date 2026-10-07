/**
 * Formats a counter with German thousands grouping without locale data.
 *
 * @param value - Non-negative whole number.
 */
export function formatCounter(value: number): string {
  if (value < 1000) {
    return String(value);
  }

  return `${Math.floor(value / 1000)}.${String(value % 1000).padStart(3, "0")}`;
}
