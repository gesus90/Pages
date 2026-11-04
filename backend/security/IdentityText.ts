/**
 * Tells whether a presented name or credential holds U+0000.
 *
 * @param text - The text at an identity boundary.
 * @returns Whether it does.
 *
 * @remarks
 * Such a text identifies nobody on either database, so it is refused like unknown
 * credentials before any statement runs. It never reaches a comparison.
 */
export function holdsNulCharacter(text: string): boolean {
  return text.includes("\u0000");
}
