/**
 * Columns of the time column: `HH:MM:SS` and two blanks. At 13 px monospace
 * this is the 80 px of the template; every line stands in the text column
 * behind it.
 */
export const GUTTER_WIDTH = 10;

/** The time column of a line without a time. */
export const EMPTY_GUTTER = " ".repeat(GUTTER_WIDTH);

/** Columns of an indented follow-up, such as the opened output of a call. */
export const OUTPUT_INDENT = " ".repeat(GUTTER_WIDTH + 2);

/**
 * The time column of a line.
 * @param time - A time as `HH:MM:SS`, or `null` for a line that carries none.
 * @param paint - Draws the time in the muted style.
 * @returns The time and the blanks after it, as wide as {@link GUTTER_WIDTH}.
 */
export function timeGutter(
  time: string | null,
  paint: (text: string) => string,
): string {
  if (time === null) return EMPTY_GUTTER;
  const blanks = " ".repeat(Math.max(2, GUTTER_WIDTH - time.length));
  return `${paint(time)}${blanks}`;
}
