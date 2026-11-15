import { useSyncExternalStore } from "react";

import type { ConversationAttachment } from "@/definition/ConversationContent";

/** Page count, title and protection of a PDF as a card shows them (PAGE-385). */
export interface PdfFacts {
  readonly pageCount?: number;
  /** The title from the metadata. */
  readonly title?: string;
  /** The PDF is protected by a password; it stays downloadable. */
  readonly isEncrypted?: boolean;
}

/**
 * Facts the browser read during this visit, by attachment ID, so every card
 * of the PDF shows them before the server answers again.
 */
const known = new Map<string, PdfFacts>();
const listeners = new Set<() => void>();
const NO_FACTS: PdfFacts = {};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The query of the page count and title as the files interface takes them.
 *
 * @param facts - What the browser read; other facts are left out.
 * @returns For example `&pageCount=12&title=Bericht`; empty without facts.
 */
export function documentFactsQuery(facts: PdfFacts): string {
  const parameters = new URLSearchParams();
  if (
    facts.pageCount !== undefined &&
    Number.isInteger(facts.pageCount) &&
    facts.pageCount > 0
  )
    parameters.set("pageCount", String(facts.pageCount));
  const title = facts.title?.trim() ?? "";
  if (title !== "") parameters.set("title", title.slice(0, 300));
  const query = parameters.toString();
  return query === "" ? "" : `&${query}`;
}

/** Notes what the browser read of a PDF, for the cards of this visit. */
export function rememberPdfFacts(attachmentId: string, facts: PdfFacts): void {
  const usable: PdfFacts = {
    ...(facts.pageCount === undefined ? {} : { pageCount: facts.pageCount }),
    ...(facts.title === undefined ? {} : { title: facts.title }),
    ...(facts.isEncrypted === true ? { isEncrypted: true } : {}),
  };
  if (Object.keys(usable).length === 0) return;
  known.set(attachmentId, { ...known.get(attachmentId), ...usable });
  for (const listener of listeners) listener();
}

/** Forgets every noted fact, for tests. */
export function resetPdfFacts(): void {
  known.clear();
}

/**
 * Page count, title and protection of a PDF: what the server stored, and
 * what a browser read during this visit.
 *
 * @param attachment - The PDF.
 */
export function usePdfFacts(
  attachment: Pick<
    ConversationAttachment,
    "id" | "pageCount" | "documentTitle"
  >,
): PdfFacts {
  const noted = useSyncExternalStore(
    subscribe,
    () => known.get(attachment.id) ?? NO_FACTS,
    () => NO_FACTS,
  );
  return {
    ...(attachment.pageCount === undefined
      ? {}
      : { pageCount: attachment.pageCount }),
    ...(attachment.documentTitle === undefined
      ? {}
      : { title: attachment.documentTitle }),
    ...noted,
  };
}
