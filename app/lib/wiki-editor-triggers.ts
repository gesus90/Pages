/** What the person is typing that opens a menu. */
export interface EditorTrigger {
  /** `slash` lists blocks at the start of a line; `reference` lists pages. */
  readonly kind: "slash" | "reference";
  /** The text typed after the trigger characters. */
  readonly query: string;
  /** Start of the trigger characters, to replace them with the choice. */
  readonly from: number;
  readonly to: number;
}

const SLASH = /^\s*\/([\p{L}\p{N}]*)$/u;
const BRACKETS = /\[\[([^\n[\]]*)$/;
const MENTION = /(?:^|[\s(])@([\p{L}\p{N}._-]*)$/u;

/**
 * Finds the menu trigger left of the caret.
 *
 * @param value - Editor text.
 * @param caret - Caret position.
 * @returns The trigger, or `null` when the caret is not behind one. A slash
 * counts only at the start of a line, `[[` and `@` anywhere.
 */
export function findEditorTrigger(
  value: string,
  caret: number,
): EditorTrigger | null {
  const lineStart = value.lastIndexOf("\n", caret - 1) + 1;
  const line = value.slice(lineStart, caret);
  const slash = SLASH.exec(line);

  if (slash) {
    const [, query = ""] = slash;

    return { from: caret - query.length - 1, kind: "slash", query, to: caret };
  }

  const brackets = BRACKETS.exec(line);

  if (brackets) {
    const [, query = ""] = brackets;

    return {
      from: caret - query.length - 2,
      kind: "reference",
      query,
      to: caret,
    };
  }

  const mention = MENTION.exec(line);

  if (mention) {
    const [, query = ""] = mention;

    return {
      from: caret - query.length - 1,
      kind: "reference",
      query,
      to: caret,
    };
  }

  return null;
}
