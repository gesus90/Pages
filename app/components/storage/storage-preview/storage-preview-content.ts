import {
  DocumentReadError,
  readDocument,
} from "@/app/components/chat-page/content/documents/read-document";
import { isPdfPasswordError } from "@/app/lib/pdf-errors";

import type { ReadDocument } from "@/app/components/chat-page/content/documents/document-model";
import type { DocumentFailure } from "@/app/components/chat-page/content/documents/read-document";
import type { PdfPreview } from "@/app/lib/pdf-preview";
import type { StoragePreviewPlan } from "./storage-preview-kind";

/** The readable content of a file, as plain data or an opened PDF. */
export type StoragePreviewContent =
  | { readonly kind: "markdown"; readonly text: string }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "pdf"; readonly preview: PdfPreview }
  | { readonly kind: "document"; readonly document: ReadDocument };

/** What turning the bytes of a file into content gives. */
export type StoragePreviewContentResult =
  | { readonly ok: true; readonly content: StoragePreviewContent }
  | { readonly ok: false; readonly reason: DocumentFailure };

async function openPdf(
  bytes: Uint8Array,
): Promise<StoragePreviewContentResult> {
  try {
    // pdf.js and its worker load only once a PDF is shown.
    const { openPdfBytes } = await import("@/app/lib/pdf-preview");

    return {
      content: { kind: "pdf", preview: await openPdfBytes(bytes) },
      ok: true,
    };
  } catch (error: unknown) {
    if (isPdfPasswordError(error)) return { ok: false, reason: "encrypted" };

    console.warn("The PDF could not be opened.", error);

    return { ok: false, reason: "unreadable" };
  }
}

async function openDocument(
  plan: StoragePreviewPlan,
  input: { readonly bytes: Uint8Array; readonly name: string },
): Promise<StoragePreviewContentResult> {
  if (plan.format === null) return { ok: false, reason: "unreadable" };

  try {
    const document = await readDocument(input.bytes, {
      format: plan.format,
      name: input.name,
    });

    return { content: { document, kind: "document" }, ok: true };
  } catch (error: unknown) {
    return {
      ok: false,
      reason: error instanceof DocumentReadError ? error.reason : "unreadable",
    };
  }
}

/**
 * Turns the bytes of a file into what the preview shows.
 * @param plan - How the file is shown.
 * @param input - The bytes and the name of the file.
 * @returns The content, or why the file cannot be read.
 * @remarks
 * Text and Markdown become a string, which the views show as text and never
 * as markup. Office and OpenDocument files are read in the browser into plain
 * data, and a PDF is opened for page drawing. Nothing of the file runs and
 * nothing outside the file is loaded.
 */
export async function buildStoragePreviewContent(
  plan: StoragePreviewPlan,
  input: { readonly bytes: Uint8Array; readonly name: string },
): Promise<StoragePreviewContentResult> {
  if (plan.kind === "pdf") return openPdf(input.bytes);

  if (plan.kind === "document") return openDocument(plan, input);

  return {
    content: { kind: plan.kind, text: new TextDecoder().decode(input.bytes) },
    ok: true,
  };
}
