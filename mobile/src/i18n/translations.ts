import type { en } from "./locales/en";

type TextTree<T> = {
  readonly [Key in keyof T]: T[Key] extends string ? string : TextTree<T[Key]>;
};

/**
 * The shape of one language: every key of the English texts holds a string.
 *
 * @remarks
 * A language that misses a key or adds a stray one does not compile.
 */
export type Translations = TextTree<typeof en>;
