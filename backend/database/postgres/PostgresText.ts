const NUL = "\u0000";
const NUL_ESCAPE = "\\u0000";

/** A backslash with what it escapes, so a doubled backslash hides the `u0000` after it. */
const BACKSLASH_PAIR = /\\(?:u0000|[\s\S])/gu;

function countNul(text: string): number {
  return text.split(NUL).length - 1;
}

/** Where the real escapes `\u0000` stand, counted without the character U+0000. */
function nulEscapePositions(text: string): readonly number[] {
  const positions: number[] = [];
  let scanned = 0;
  let nulCharacters = 0;
  for (const { 0: pair, index } of text.matchAll(BACKSLASH_PAIR)) {
    if (pair !== NUL_ESCAPE) continue;
    nulCharacters += countNul(text.slice(scanned, index));
    scanned = index;
    positions.push(index - nulCharacters);
  }
  return positions;
}

function isValidJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Takes U+0000 out of a text that is about to be stored on PostgreSQL, which cannot
 * store the character.
 *
 * @param text - The text.
 * @returns The text without the character, or `null` when that is not allowed: it
 * would change the number or the place of the real escapes `\u0000`, as a backslash,
 * the character and `u0000` would, or it would make a valid JSON document of an
 * invalid one.
 *
 * @remarks
 * Saving and `db:transfer` share this rule, so both stop on the same texts. A valid
 * JSON document holds no such character and passes unchanged. Only for values to be
 * written: a value that is compared must keep its identity.
 */
export function textWithoutNul(text: string): string | null {
  if (!text.includes(NUL)) return text;
  const cleaned = text.replaceAll(NUL, "");
  const before = nulEscapePositions(text);
  const after = nulEscapePositions(cleaned);
  const hasSameEscapes =
    before.length === after.length &&
    before.every((position, index) => position === after[index]);
  return hasSameEscapes && !isValidJson(cleaned) ? cleaned : null;
}
