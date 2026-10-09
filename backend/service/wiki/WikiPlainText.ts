/**
 * Reduces whitespace runs to a single blank.
 *
 * @param text - Any text.
 * @returns The text with every run of whitespace replaced by one blank and
 * no blank at either end.
 */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Approximates the text a reader sees for a markdown source.
 *
 * @param markdown - Markdown text of a page.
 * @returns The text without block anchors, links, images, emphasis marks,
 * headings marks, quote and list markers, code fences and table lines, with
 * whitespace collapsed.
 *
 * @remarks
 * A comment on a passage keeps the passage as the reader selected it, which
 * is rendered text. Comparing it with this reduction tells whether the
 * passage is still there, without needing the renderer on the server.
 */
export function toPlainText(markdown: string): string {
  return collapseWhitespace(
    markdown
      .replace(/<!--\s*block:[a-z0-9]{1,32}\s*-->/g, " ")
      .replace(/^\s*(```|~~~).*$/gm, " ")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/^\s{0,3}(?:#{1,6}|>+|[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?/gm, "")
      .replace(/^\s*\|?\s*:?-{3,}:?(?:\s*\|\s*:?-{3,}:?)*\s*\|?\s*$/gm, " ")
      .replace(/\|/g, " ")
      .replace(/\[!\w+\]/g, " ")
      .replace(/[*_`~]/g, ""),
  );
}
