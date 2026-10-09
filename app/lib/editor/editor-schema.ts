/** Names of the node types of the block editor schema. */
export const EDITOR_NODE = {
  blockquote: "blockquote",
  bulletList: "bulletList",
  callout: "callout",
  codeBlock: "codeBlock",
  doc: "doc",
  hardBreak: "hardBreak",
  heading: "heading",
  horizontalRule: "horizontalRule",
  image: "image",
  listItem: "listItem",
  orderedList: "orderedList",
  paragraph: "paragraph",
  rawMarkdown: "rawMarkdown",
  table: "table",
  tableCell: "tableCell",
  tableHeader: "tableHeader",
  tableOfContents: "tableOfContents",
  tableRow: "tableRow",
  taskItem: "taskItem",
  taskList: "taskList",
  text: "text",
  toggle: "toggle",
  toggleSummary: "toggleSummary",
} as const;

/** Names of the mark types of the block editor schema. */
export const EDITOR_MARK = {
  bold: "bold",
  code: "code",
  italic: "italic",
  link: "link",
  strike: "strike",
} as const;

/** Node types that may carry a block anchor (`<!-- block:id -->`). */
export const ANCHORABLE_NODES: readonly string[] = [
  EDITOR_NODE.paragraph,
  EDITOR_NODE.heading,
  EDITOR_NODE.blockquote,
  EDITOR_NODE.bulletList,
  EDITOR_NODE.orderedList,
  EDITOR_NODE.taskList,
  EDITOR_NODE.codeBlock,
  EDITOR_NODE.horizontalRule,
  EDITOR_NODE.table,
  EDITOR_NODE.callout,
  EDITOR_NODE.toggle,
  EDITOR_NODE.tableOfContents,
];

/** Node types whose lists can be loose (blank lines between items). */
export const LIST_NODES: readonly string[] = [
  EDITOR_NODE.bulletList,
  EDITOR_NODE.orderedList,
  EDITOR_NODE.taskList,
];

/** Node and mark attributes as ProseMirror hands them out. */
export type EditorAttributes = Readonly<Record<string, unknown>>;

/**
 * Reads a text attribute.
 *
 * @param attributes - Attributes of a node or mark.
 * @param name - Attribute name.
 * @returns The value, or `null` when it is missing or no non-empty text.
 */
export function readTextAttribute(
  attributes: EditorAttributes,
  name: string,
): string | null {
  const value = attributes[name];

  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * Reads a whole-number attribute.
 *
 * @param attributes - Attributes of a node or mark.
 * @param name - Attribute name.
 * @param fallback - Value for a missing or malformed attribute.
 * @returns The number.
 */
export function readNumberAttribute(
  attributes: EditorAttributes,
  name: string,
  fallback: number,
): number {
  const value = attributes[name];

  return typeof value === "number" && Number.isInteger(value)
    ? value
    : fallback;
}

/**
 * Reads a yes/no attribute.
 *
 * @param attributes - Attributes of a node or mark.
 * @param name - Attribute name.
 * @returns Whether the attribute is `true`.
 */
export function readFlagAttribute(
  attributes: EditorAttributes,
  name: string,
): boolean {
  return attributes[name] === true;
}
