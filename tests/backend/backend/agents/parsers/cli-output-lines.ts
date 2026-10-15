/** Joins events into the JSON-lines output a CLI prints, one object per line. */
export function jsonLines(events: readonly unknown[]): string {
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}
