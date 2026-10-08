/** The text of the editor and the selection in it. */
export interface EditorText {
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

/** Everything the toolbar and the slash menu can insert or toggle. */
export const WIKI_EDITOR_COMMANDS = [
  "heading1",
  "heading2",
  "heading3",
  "bold",
  "italic",
  "code",
  "link",
  "bullet",
  "numbered",
  "task",
  "quote",
  "codeBlock",
  "table",
  "callout",
  "toggle",
  "divider",
  "contents",
] as const;

/** A command of the editor. */
export type WikiEditorCommand = (typeof WIKI_EDITOR_COMMANDS)[number];

const INLINE_MARKERS: Readonly<
  Partial<
    Record<WikiEditorCommand, { before: string; after: string; sample: string }>
  >
> = {
  bold: { after: "**", before: "**", sample: "bold" },
  code: { after: "`", before: "`", sample: "code" },
  italic: { after: "_", before: "_", sample: "italic" },
};

const LINE_PREFIXES: Readonly<Partial<Record<WikiEditorCommand, string>>> = {
  bullet: "- ",
  heading1: "# ",
  heading2: "## ",
  heading3: "### ",
  quote: "> ",
  task: "- [ ] ",
};

const BLOCKS: Readonly<
  Partial<Record<WikiEditorCommand, { text: string; select: string }>>
> = {
  callout: { select: "text", text: "> [!NOTE]\n> text" },
  codeBlock: { select: "code", text: "```\ncode\n```" },
  contents: { select: "", text: "[toc]" },
  divider: { select: "", text: "---" },
  table: {
    select: "",
    text: "| Column 1 | Column 2 |\n| --- | --- |\n| Cell | Cell |",
  },
  toggle: { select: "text", text: "> [!TOGGLE] Title\n> text" },
};

const LIST_ITEM = /^(\s*)(?:([-*+])|(\d+)\.)\s+(\[[ xX]\]\s+)?/;
const ORDERED_PREFIX = /^(\s*)(\d+)\.\s/;

function replaceRange(
  state: EditorText,
  range: { readonly from: number; readonly to: number },
  text: string,
  selection: { start: number; end: number },
): EditorText {
  const { from, to } = range;

  return {
    end: selection.end,
    start: selection.start,
    value: state.value.slice(0, from) + text + state.value.slice(to),
  };
}

function lineBounds(state: EditorText): { from: number; to: number } {
  const from = state.value.lastIndexOf("\n", state.start - 1) + 1;
  const newline = state.value.indexOf("\n", state.end);

  return { from, to: newline < 0 ? state.value.length : newline };
}

function wrapSelection(
  state: EditorText,
  marker: { before: string; after: string; sample: string },
): EditorText {
  const selected = state.value.slice(state.start, state.end);
  const inner = selected === "" ? marker.sample : selected;
  const text = marker.before + inner + marker.after;
  const start = state.start + marker.before.length;

  return replaceRange(state, { from: state.start, to: state.end }, text, {
    end: start + inner.length,
    start,
  });
}

function insertLink(state: EditorText): EditorText {
  const selected = state.value.slice(state.start, state.end);
  const label = selected === "" ? "text" : selected;
  const text = `[${label}](https://)`;
  const urlStart = state.start + label.length + 3;

  return replaceRange(state, { from: state.start, to: state.end }, text, {
    end: urlStart + "https://".length,
    start: urlStart,
  });
}

/**
 * Places the selection after lines were changed: the changed lines stay
 * selected, so that the command can be undone with the same click; a caret
 * stays a caret and moves with the text in front of it.
 */
function selectChangedLines(
  state: EditorText,
  from: number,
  lengths: { readonly before: number; readonly after: number },
): { start: number; end: number } {
  if (state.start !== state.end) {
    return { end: from + lengths.after, start: from };
  }

  const caret = Math.min(
    Math.max(from, state.start + lengths.after - lengths.before),
    from + lengths.after,
  );

  return { end: caret, start: caret };
}

function toggleLinePrefix(state: EditorText, prefix: string): EditorText {
  const { from, to } = lineBounds(state);
  const lines = state.value.slice(from, to).split("\n");
  const allPrefixed = lines.every((line) => line.startsWith(prefix));
  const changed = lines.map((line) =>
    allPrefixed ? line.slice(prefix.length) : `${prefix}${line}`,
  );
  const text = changed.join("\n");

  return replaceRange(
    state,
    { from: from, to: to },
    text,
    selectChangedLines(state, from, {
      after: text.length,
      before: to - from,
    }),
  );
}

function numberLines(state: EditorText): EditorText {
  const { from, to } = lineBounds(state);
  const lines = state.value.slice(from, to).split("\n");
  const allNumbered = lines.every((line) => ORDERED_PREFIX.test(line));
  const changed = lines.map((line, index) =>
    allNumbered ? line.replace(ORDERED_PREFIX, "$1") : `${index + 1}. ${line}`,
  );
  const text = changed.join("\n");

  return replaceRange(
    state,
    { from: from, to: to },
    text,
    selectChangedLines(state, from, {
      after: text.length,
      before: to - from,
    }),
  );
}

function insertBlock(
  state: EditorText,
  block: { text: string; select: string },
): EditorText {
  const { from, to } = lineBounds(state);
  const isLineEmpty = state.value.slice(from, to).trim() === "";
  const lead = isLineEmpty ? "" : "\n";
  const at = isLineEmpty ? from : to;
  const text = lead + block.text;
  const selectAt =
    block.select === "" ? -1 : block.text.lastIndexOf(block.select);
  const caret = at + text.length;
  const start = selectAt < 0 ? caret : at + lead.length + selectAt;

  return replaceRange(state, { from: at, to: isLineEmpty ? to : at }, text, {
    end: selectAt < 0 ? caret : start + block.select.length,
    start,
  });
}

/**
 * Applies a toolbar or slash command to the editor text.
 *
 * @param state - Text and selection.
 * @param command - The command.
 * @returns The new text and selection.
 */
export function applyEditorCommand(
  state: EditorText,
  command: WikiEditorCommand,
): EditorText {
  const marker = INLINE_MARKERS[command];
  const prefix = LINE_PREFIXES[command];
  const block = BLOCKS[command];

  if (marker) {
    return wrapSelection(state, marker);
  }

  if (prefix) {
    return toggleLinePrefix(state, prefix);
  }

  if (block) {
    return insertBlock(state, block);
  }

  return command === "numbered" ? numberLines(state) : insertLink(state);
}

/**
 * Continues a list when the person presses Enter in a list item.
 *
 * @param state - Text and caret.
 * @returns The new text, or `null` when the line is no list item. An empty
 * item ends the list instead of adding another.
 */
export function continueList(state: EditorText): EditorText | null {
  if (state.start !== state.end) {
    return null;
  }

  const from = state.value.lastIndexOf("\n", state.start - 1) + 1;
  const line = state.value.slice(from, state.start);
  const match = LIST_ITEM.exec(line);

  if (!match) {
    return null;
  }

  const [marker = "", indent = "", bullet, number, task] = match;

  if (line.length === marker.length) {
    return replaceRange(state, { from: from, to: state.start }, "", {
      end: from,
      start: from,
    });
  }

  const next = number
    ? `${indent}${Number(number) + 1}. `
    : `${indent}${bullet} `;
  const insert = `\n${next}${task ? "[ ] " : ""}`;
  const caret = state.start + insert.length;

  return replaceRange(state, { from: state.start, to: state.end }, insert, {
    end: caret,
    start: caret,
  });
}

/**
 * Replaces a range of the text, as the slash menu and the picker do.
 *
 * @param state - Text and selection.
 * @param from - Start of the range.
 * @param to - End of the range.
 * @param text - Replacement.
 * @returns The new text with the caret behind the replacement.
 */
export function replaceEditorRange(
  state: EditorText,
  from: number,
  to: number,
  text: string,
): EditorText {
  const caret = from + text.length;

  return replaceRange(state, { from: from, to: to }, text, {
    end: caret,
    start: caret,
  });
}
