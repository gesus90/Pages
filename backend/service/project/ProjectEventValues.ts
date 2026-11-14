/** Normalizes a blank event time to the absence of a time. */
export function normalizeEventTime(eventTime: string | null): string | null {
  const trimmedTime = eventTime?.trim();
  return trimmedTime === undefined || trimmedTime === "" ? null : trimmedTime;
}

/** Validates a planning date and returns its trimmed title. */
export function validateEvent(event: {
  readonly title: string;
  readonly eventDate: string;
}): string {
  const title = event.title.trim();
  if (!title || title.length > 200)
    throw new Error("Event title must be between 1 and 200 characters.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event.eventDate))
    throw new Error("Event date must use the format YYYY-MM-DD.");
  return title;
}
