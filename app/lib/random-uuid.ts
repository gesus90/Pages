/**
 * Creates a random version 4 UUID in the browser.
 *
 * @remarks
 * `crypto.randomUUID` exists only in secure contexts, but Pages also runs on
 * plain HTTP in an intranet; `crypto.getRandomValues` works in both.
 */
export function createRandomUuid(): string {
  const randomBytes = crypto.getRandomValues(new Uint8Array(16));
  randomBytes[6] = (randomBytes[6] & 0x0f) | 0x40;
  randomBytes[8] = (randomBytes[8] & 0x3f) | 0x80;
  const encodedBytes = Array.from(randomBytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return [
    encodedBytes.slice(0, 8),
    encodedBytes.slice(8, 12),
    encodedBytes.slice(12, 16),
    encodedBytes.slice(16, 20),
    encodedBytes.slice(20),
  ].join("-");
}
