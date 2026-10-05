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

/**
 * Formats a stored date or timestamp for the project screens.
 *
 * @param value - Date such as `2026-09-30`, a timestamp, or `null`.
 * @returns The German date, `---` without a value, or the raw value when it
 * cannot be parsed.
 */
export function formatDate(value: string | null): string {
  if (!value) {
    return "---";
  }

  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("de-DE");
}
