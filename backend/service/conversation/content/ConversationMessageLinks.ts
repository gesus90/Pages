import { readLinkLine } from "./ConversationLinks";

/** A link a message names, with the text it is written under. */
export interface FoundMessageLink {
  readonly url: string;
  /** The text of a Markdown link; empty for a bare address. */
  readonly label: string;
}

const FENCE = /^\s*(```|~~~)/u;
const INLINE_CODE = /`[^`\n]*`/gu;
const MARKDOWN_LINK = /\[([^\]\n]{0,300})\]\((https?:\/\/[^\s)]+)\)/giu;
const BARE_ADDRESS = /https?:\/\/[^\s<>()[\]"'`]+/giu;
/** Signs that end a sentence rather than an address. */
const TRAILING_SIGNS = /[.,;:!?*_~]+$/u;

/** The lines of a message outside its code blocks, without inline code. */
function proseOf(text: string): string {
  const lines: string[] = [];
  let isCode = false;
  for (const line of text.split("\n")) {
    if (FENCE.test(line)) {
      isCode = !isCode;
      continue;
    }
    if (!isCode) lines.push(line.replace(INLINE_CODE, " "));
  }
  return lines.join("\n");
}

/**
 * Finds every link a message names outside code (PAGE-387): Markdown links
 * with their text and bare addresses, each once, in their order.
 *
 * @param text - The text of the message.
 * @returns The normalized addresses; addresses with credentials or no host
 * are left out, as the link cards of the chat leave them out.
 */
export function findMessageLinks(text: string): FoundMessageLink[] {
  const found = new Map<string, FoundMessageLink>();
  const prose = proseOf(text);
  const add = (candidate: string, label: string): void => {
    const url = readLinkLine(candidate.replace(TRAILING_SIGNS, ""));
    if (url !== null && !found.has(url)) found.set(url, { url, label });
  };
  for (const match of prose.matchAll(MARKDOWN_LINK))
    add(match[2] ?? "", (match[1] ?? "").trim());
  for (const match of prose.replace(MARKDOWN_LINK, " ").matchAll(BARE_ADDRESS))
    add(match[0], "");
  return [...found.values()];
}
