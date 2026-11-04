import { randomUUID } from "node:crypto";

let lastMillisecond = 0;

/**
 * Creates an identifier that sorts by creation.
 *
 * @returns An identifier in the layout of a UUIDv7: the milliseconds first, then
 * random bits.
 *
 * @remarks
 * Stored times have whole seconds. A list that ends on such an identifier keeps two
 * rows of one second in the order they were created, in every database.
 */
export function createTimeOrderedId(): string {
  lastMillisecond = Math.max(Date.now(), lastMillisecond + 1);
  const time = lastMillisecond.toString(16).padStart(12, "0");
  const random = randomUUID();

  return `${time.slice(0, 8)}-${time.slice(8)}-7${random.slice(15)}`;
}
