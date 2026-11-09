import { LABEL_COLORS } from "./Task";

/**
 * The fixed palette of person colors (PAGE-266).
 *
 * @remarks
 * Every person and every agent may pick one of these twelve colors. It is
 * stored in `users.avatar_color` and drawn as the ring around the avatar and
 * as the name color in the chat. The palette is the one of labels, so the
 * colors of Pages stay one family.
 */
export const PERSON_COLORS = LABEL_COLORS;

/** A color of {@link PERSON_COLORS}. */
export type PersonColor = (typeof PERSON_COLORS)[number];

/**
 * Narrows an unknown value to a color of the fixed palette.
 *
 * @param value - Value received from an untrusted source.
 * @returns Whether the value is one of the twelve person colors.
 */
export function isPersonColor(value: unknown): value is PersonColor {
  return (
    typeof value === "string" &&
    (PERSON_COLORS as readonly string[]).includes(value.toLowerCase())
  );
}

/**
 * Reads a stored or submitted person color.
 *
 * @param value - The stored value or a form field.
 * @returns The palette color in lower case, or `null` for none or any other value.
 */
export function readPersonColor(value: unknown): PersonColor | null {
  if (!isPersonColor(value)) return null;
  const lower = value.toLowerCase();
  return PERSON_COLORS.find((color) => color === lower) ?? null;
}
