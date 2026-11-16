import type { StoredConversationDocumentFacts } from "@/backend/database/repositories/conversation/ConversationAttachmentRepository";
import type {
  ConversationAttachment,
  ConversationAttachmentKind,
} from "@/definition/ConversationContent";

/** Most pages Pages stores as the page count of a document. */
const MAXIMUM_PAGES = 100_000;
/** Longest title Pages stores, in characters. */
const MAXIMUM_TITLE_LENGTH = 300;
/** Control characters never belong into a title that is shown as text. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]+/gu;

/** The facts of a document as a request names them, before they are checked. */
export interface ConversationDocumentFactsInput {
  readonly pageCount?: unknown;
  readonly title?: unknown;
}

function readPageCount(input: unknown): number | null {
  const value =
    typeof input === "string" && input.trim() !== "" ? Number(input) : input;
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value >= 1 && value <= MAXIMUM_PAGES ? value : null;
}

function readTitle(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const title = input
    .replace(CONTROL_CHARACTERS, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (title === "") return null;
  return [...title].slice(0, MAXIMUM_TITLE_LENGTH).join("");
}

/**
 * Checks the page count and the title the browser read of a PDF.
 * @remarks
 * The title is plain text: control characters become spaces and it is cut
 * to 300 characters. A page count outside 1 to 100 000 counts as unknown.
 * @param kind - The kind of the attachment.
 * @param input - Page count and title as the request names them.
 * @returns The facts to store, or `null` when nothing usable remains or the
 * attachment is no PDF.
 */
export function readConversationDocumentFacts(
  kind: ConversationAttachmentKind,
  input: ConversationDocumentFactsInput,
): StoredConversationDocumentFacts | null {
  if (kind !== "pdf") return null;
  const pageCount = readPageCount(input.pageCount);
  const title = readTitle(input.title);
  if (pageCount === null && title === null) return null;
  return { pageCount, title };
}

/**
 * The facts of a stored document as every client sees them.
 * @param document - The stored facts, or `null`.
 */
export function conversationDocumentFactsOf(
  document: StoredConversationDocumentFacts | null | undefined,
): Pick<ConversationAttachment, "pageCount" | "documentTitle"> {
  if (!document) return {};
  return {
    ...(document.pageCount !== null ? { pageCount: document.pageCount } : {}),
    ...(document.title !== null ? { documentTitle: document.title } : {}),
  };
}
