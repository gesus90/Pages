/**
 * Returns the short GMT offset of a time zone, shown next to its name.
 *
 * @param timeZone - IANA time zone name.
 * @returns The current offset such as `GMT+02:00`, or the zone name itself
 * when the runtime does not know the zone.
 */
export function formatTimezoneOffset(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      timeZoneName: "longOffset",
    })
      .formatToParts(new Date())
      .filter((part) => part.type === "timeZoneName")
      .map((part) => part.value)
      .join("");
  } catch {
    return timeZone;
  }
}
