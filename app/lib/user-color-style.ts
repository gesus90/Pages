import type { CSSProperties } from "react";

/**
 * Inline style of an element tinted in a color a user chose.
 *
 * @remarks
 * The color is handed to the `pages-user-color-text` class as a custom
 * property, so the stylesheet decides how readable text in that color is in
 * each theme.
 */
export interface UserColorStyle extends CSSProperties {
  readonly "--chip-color": string;
  readonly "--chip-text"?: string;
}

/**
 * Builds the style of an element whose text is drawn in a user-chosen color.
 *
 * @param color - The color as stored, `#rrggbb`.
 * @returns The style to combine with the `pages-user-color-text` class.
 */
export function createUserTextColorStyle(color: string): UserColorStyle {
  return { "--chip-color": color };
}

/**
 * Builds the style of a chip that shows a user-chosen color as a tint.
 *
 * @param color - The color as stored, `#rrggbb`.
 * @param tintAlpha - Two hex digits for the opacity of the background tint.
 * @param lightText - Text color for the light theme instead of the color
 * itself, for colors that are too light to read on their own tint.
 * @returns The style to combine with the `pages-user-color-text` class.
 */
export function createUserColorStyle(
  color: string,
  tintAlpha: string,
  lightText?: string,
): UserColorStyle {
  return {
    ...createUserTextColorStyle(color),
    ...(lightText === undefined ? {} : { "--chip-text": lightText }),
    backgroundColor: `${color}${tintAlpha}`,
  };
}
