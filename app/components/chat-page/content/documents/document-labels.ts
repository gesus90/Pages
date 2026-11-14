import { FileSpreadsheet, FileText, Presentation } from "lucide-react";

import type { TFunction } from "i18next";
import type { LucideIcon } from "lucide-react";
import type { DocumentFormat, DocumentView } from "./document-kinds";
import type { ReadDocument } from "./document-model";

/** The icon of each view, as the card head shows it. */
export const DOCUMENT_ICONS: Readonly<Record<DocumentView, LucideIcon>> = {
  word: FileText,
  slides: Presentation,
  sheet: FileSpreadsheet,
};

/**
 * The kind of a document as a card head names it, such as "Word-Dokument"
 * or "OpenDocument-Tabelle".
 *
 * @param format - The format.
 * @param t - The translation of the page.
 */
export function documentKindLabel(format: DocumentFormat, t: TFunction): string {
  return t(`chatPage.cards.document.format.${format}`);
}

/**
 * The extent of a read document as the head shows it: pages, slides, or
 * sheets and rows.
 *
 * @param document - The read document, or `null` before it is read.
 * @param t - The translation of the page.
 * @returns For example "3 Seiten", "12 Folien" or "2 Blätter · 140 Zeilen"; empty before.
 */
export function documentExtent(document: ReadDocument | null, t: TFunction): string {
  if (document === null) return "";
  if (document.kind === "word") return t("chatPage.cards.document.pages", { count: document.pageCount });
  if (document.kind === "slides") return t("chatPage.cards.slides.count", { count: document.slides.length });
  const rows = document.sheets.reduce((sum, sheet) => sum + Math.max(0, sheet.rows.length - 1), 0);
  const sheets = t("chatPage.cards.sheet.sheetCount", { count: document.sheets.length });
  return `${sheets} · ${t("chatPage.cards.sheet.rows", { count: rows })}`;
}
