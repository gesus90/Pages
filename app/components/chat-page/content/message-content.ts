import { CARD_TEXT_MAXIMUM_BYTES } from "./card-types";
import { detectCodeLanguage } from "./code-detection";
import { documentFormatOf } from "./documents/document-kinds";
import { companionRole, previewFileName, previewKindOf } from "./preview-kinds";
import { resolveSyntaxLanguage } from "./syntax-highlight";

import type { ConversationAttachment } from "@/definition/ConversationContent";
import type { PreviewFile } from "./preview-kinds";

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
      /** Set when the fence named no language and Pages recognized it (PAGE-383). */
      readonly isDetected?: true;
    }
  | { readonly kind: "diff"; readonly source: string }
  | {
      readonly kind: "markdown";
      readonly source: string;
      readonly isDetected?: true;
    }
  | {
      /**
       * An HTML block with the CSS and JavaScript blocks of the same message,
       * shown as one preview (PAGE-383).
       */
      readonly kind: "preview";
      /** The HTML file first, then the style sheets and the scripts. */
      readonly files: readonly PreviewFile[];
      readonly isDetected: boolean;
    }
  | { readonly kind: "link"; readonly url: string };

type CodePart = Extract<MessagePart, { readonly kind: "code" }>;

/** How the chat shows an attachment whose text it renders itself. */
export type TextAttachmentKind = "code" | "diff" | "markdown";

/**
 * Endings of plain text files the chat shows as a text card (PAGE-385), such
 * as notes and logs; their language stays plain text.
 */
const PLAIN_TEXT_ENDINGS: readonly string[] = [
  "txt",
  "text",
  "log",
  "ini",
  "cfg",
  "conf",
  "properties",
  "env",
  "rst",
  "adoc",
  "nfo",
];

/** Whether a file is plain text by its ending or by its type `text/plain`. */
function isPlainText(
  attachment: Pick<ConversationAttachment, "name" | "mimeType">,
): boolean {
  const dot = attachment.name.lastIndexOf(".");
  const ending = dot >= 0 ? attachment.name.slice(dot + 1).toLowerCase() : "";
  if (PLAIN_TEXT_ENDINGS.includes(ending)) return true;
  return (
    attachment.mimeType.split(";")[0]?.trim().toLowerCase() === "text/plain"
  );
}

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

/** A fence without language and name: its language is recognized from the content. */
function toDetectedPart(source: string): MessagePart {
  const detected = detectCodeLanguage(source);
  if (detected === null)
    return { kind: "code", name: "", languageHint: "", source };
  if (detected === "diff") return { kind: "diff", source };
  if (detected === "markdown")
    return { kind: "markdown", source, isDetected: true };
  return {
    kind: "code",
    name: "",
    languageHint: detected,
    source,
    isDetected: true,
  };
}

function toFencePart(fence: OpenFence): MessagePart {
  const source = fence.lines.join("\n");
  const { name, languageHint } = readFenceInfo(fence.info);
  // An explicit language always wins; only a bare fence is recognized.
  if (languageHint === "") return toDetectedPart(source);
  const hint = languageHint.toLowerCase();
  if (DIFF_HINTS.includes(hint)) return { kind: "diff", source };
  if (MARKDOWN_HINTS.includes(hint)) return { kind: "markdown", source };
  return { kind: "code", name, languageHint, source };
}

function isCodePart(part: MessagePart): part is CodePart {
  return part.kind === "code";
}

/**
 * Joins the first HTML block of a message with its CSS and JavaScript blocks
 * into one preview (PAGE-383); the joined blocks leave their places.
 *
 * @param parts - The parts of a message in their order.
 * @returns The parts with the HTML block as a preview, or unchanged without one.
 */
export function joinPreviewParts(parts: readonly MessagePart[]): MessagePart[] {
  const html = parts
    .filter(isCodePart)
    .find((part) => previewKindOf(part.languageHint) === "html");
  if (!html) return [...parts];
  const companions = parts
    .filter(isCodePart)
    .filter((part) => companionRole(part.languageHint) !== null);
  const counts = { css: 0, js: 0 };
  const files: PreviewFile[] = [
    {
      name: previewFileName(html.name, "html"),
      languageHint: html.languageHint,
      source: html.source,
    },
  ];
  for (const role of ["css", "js"] as const)
    for (const part of companions) {
      if (companionRole(part.languageHint) !== role) continue;
      files.push({
        name: previewFileName(part.name, role, counts[role]),
        languageHint: part.languageHint,
        source: part.source,
      });
      counts[role] += 1;
    }
  const preview: MessagePart = {
    kind: "preview",
    files,
    isDetected: html.isDetected === true,
  };
  return parts
    .filter((part) => !isCodePart(part) || !companions.includes(part))
    .map((part) => (part === html ? preview : part));
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
 * @remarks
 * A fence without a language gets the one its content shows clearly, else
 * it stays plain text (PAGE-383). The first HTML block takes the CSS and
 * JavaScript blocks of the message into one preview.
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
  return joinPreviewParts(parts);
}

/**
 * Tells whether the chat renders an attachment as code, diff or Markdown
 * instead of offering it as a file.
 *
 * @param attachment - The attachment.
 * @returns The kind of text card; plain text such as `.txt` or `.log` is a
 * code card in plain text (PAGE-385). `null` for media, documents and tables,
 * unknown types and text above 1 MB.
 */
export function textAttachmentKind(
  attachment: ConversationAttachment,
): TextAttachmentKind | null {
  if (
    attachment.kind !== "file" ||
    attachment.sizeBytes > CARD_TEXT_MAXIMUM_BYTES ||
    documentFormatOf(attachment) !== null
  )
    return null;
  const language = resolveSyntaxLanguage(attachment.name);
  if (language === "diff") return "diff";
  if (language === "markdown") return "markdown";
  if (language !== null) return "code";
  return isPlainText(attachment) ? "code" : null;
}
