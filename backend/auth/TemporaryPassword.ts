import { randomInt } from "node:crypto";

const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Generates an unbiased, readable temporary password for one account operation. */
export function generateTemporaryPassword(): string {
  return Array.from({ length: 3 }, () =>
    Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(
      "",
    ),
  ).join("-");
}
