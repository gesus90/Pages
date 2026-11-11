import { CARD_TEXT_MAXIMUM_BYTES } from "./card-types";
import { resolveSyntaxLanguage } from "./syntax-highlight";

import type { ConversationAttachment } from "@/definition/ConversationContent";

/** One part of a message text, in its order (PAGE-298). */
export type MessagePart =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "code";
      /** The file name the fence names, or empty. */
      readonly name: string;
      /** The language word of the fence, or the file name; empty without one. */
      readonly languageHint: string;
      readonly source: string;
    }
  | { readonly kind: "diff"; readonly source: string }
  | { readonly kind: "markdown"; readonly source: string }
  | { readonly kind: "link"; readonly url: string };

/** How the chat shows an attachment whose text it renders itself. */
export type TextAttachmentKind = "code" | "diff" | "markdown";

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})\s*([^`]*)$/u;
/** A URL alone in a line; the editor writes it as an autolink in angle brackets. */
const URL_LINE = /^\s*<?(https?:\/\/[^\s<>]+)>?\s*$/iu;
const MAXIMUM_URL_LENGTH = 2_000;
const MARKDOWN_HINTS: readonly string[] = ["markdown", "md", "mdx"];
const DIFF_HINTS: readonly string[] = ["diff", "patch"];

/** A code fence that is still open while the lines of a message are read. */
interface OpenFence {
  readonly marker: string;
  readonly info: string;
  readonly lines: string[];
}

function isFenceClose(line: string, fence: OpenFence): boolean {
  const trimmed = line.trim();
  return (
    trimmed.length >= fence.marker.length &&
    trimmed.startsWith(fence.marker) &&
    trimmed.replaceAll(fence.marker[0] ?? "`", "") === ""
  );
}

/** Reads the language and the file name of a fence info such as `ts title=a.ts` or `a.ts`. */
function readFenceInfo(info: string): {
  readonly name: string;
  readonly languageHint: string;
} {
  const words = info.trim().split(/\s+/u).filter(Boolean);
  const [first = "", ...rest] = words;
  const titled = rest
    .map((word) => /^(?:title|file|name)=["']?([^"']+)["']?$/u.exec(word)?.[1])
    .find((title) => title !== undefined);
  const named = [first, ...rest].find(
    (word) => /^[\w./-]+\.\w+$/u.test(word) && !word.includes("="),
  );
  const name = titled ?? named ?? "";
  const cleanFirst = first.replace(/^\{?\.?/u, "").replace(/[:}].*$/u, "");
  return { name, languageHint: cleanFirst === "" ? name : cleanFirst };
}

function toFencePart(fence: OpenFence): MessagePart {
  const source = fence.lines.join("\n");
  const { name, languageHint } = readFenceInfo(fence.info);
  const hint = languageHint.toLowerCase();
  if (DIFF_HINTS.includes(hint)) return { kind: "diff", source };
  if (MARKDOWN_HINTS.includes(hint)) return { kind: "markdown", source };
  return { kind: "code", name, languageHint, source };
}

function readUrlLine(line: string): string | null {
  const address = line.length > MAXIMUM_URL_LENGTH ? null : URL_LINE.exec(line);
  if (!address?.[1]) return null;
  try {
    const url = new URL(address[1]);
    return url.username === "" && url.password === "" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Splits the text of a message into what the chat shows as text and what it
 * shows as cards: fenced code, ` ```diff ` blocks, ` ```markdown ` blocks and
 * a URL that stands alone in a line.
 *
 * @param text - The Markdown text of the message.
 * @returns The parts in their order; text between cards keeps its lines.
 * A fence that never closes holds the rest of the message.
 */
export function parseMessageContent(text: string): MessagePart[] {
  const parts: MessagePart[] = [];
  let pending: string[] = [];
  let fence: OpenFence | null = null;

  function flushText(): void {
    const joined = pending.join("\n").trim();
    if (joined !== "") parts.push({ kind: "text", text: joined });
    pending = [];
  }

  for (const line of text.split("\n")) {
    if (fence !== null) {
      if (isFenceClose(line, fence)) {
        parts.push(toFencePart(fence));
        fence = null;
      } else fence.lines.push(line);
      continue;
    }
    const opened = FENCE_OPEN.exec(line);
    const url = opened ? null : readUrlLine(line);
    if (!opened && url === null) {
      pending.push(line);
      continue;
    }
    flushText();
    if (opened)
      fence = { marker: opened[1] ?? "```", info: opened[2] ?? "", lines: [] };
    else if (url !== null) parts.push({ kind: "link", url });
  }
  if (fence !== null) parts.push(toFencePart(fence));
  flushText();
  return parts;
}

/**
 * Tells whether the chat renders an attachment as code, diff or Markdown
 * instead of offering it as a file.
 *
 * @param attachment - The attachment.
 * @returns The kind of text card; `null` for media, unknown types and text
 * above 1 MB.
 */
export function textAttachmentKind(
  attachment: ConversationAttachment,
): TextAttachmentKind | null {
  if (
    attachment.kind !== "file" ||
    attachment.sizeBytes > CARD_TEXT_MAXIMUM_BYTES
  )
    return null;
  const language = resolveSyntaxLanguage(attachment.name);
  if (language === "diff") return "diff";
  if (language === "markdown") return "markdown";
  return language === null ? null : "code";
}
