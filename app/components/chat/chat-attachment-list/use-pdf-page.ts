import { useEffect, useRef, useState } from "react";

import { chatAttachmentUrl } from "@/app/lib/chat-client";

import type { RefObject } from "react";
import type { PdfPreview } from "@/app/lib/pdf-preview";

/** PDFs kept open in the page; the oldest closes when another one opens. */
const OPEN_DOCUMENTS = 6;
const documents = new Map<string, Promise<PdfPreview>>();

function openDocument(id: string): Promise<PdfPreview> {
  const cached = documents.get(id);
  if (cached) return cached;
  const opening = import("@/app/lib/pdf-preview").then(({ openPdfPreview }) =>
    openPdfPreview(chatAttachmentUrl(id), new AbortController().signal),
  );
  documents.set(id, opening);
  opening.catch(() => documents.delete(id));
  const oldest = documents.keys().next().value;
  if (documents.size > OPEN_DOCUMENTS && oldest !== undefined) {
    const closing = documents.get(oldest);
    documents.delete(oldest);
    void closing?.then((document) => document.close()).catch(() => undefined);
  }
  return opening;
}

/** The state of one page drawn from a PDF. */
export interface PdfPageState {
  readonly canvas: RefObject<HTMLCanvasElement | null>;
  readonly pageCount: number | null;
  readonly status: "loading" | "ready" | "encrypted" | "failed";
}

/**
 * Draws one page of an own PDF attachment into a canvas once it is wanted.
 *
 * @param input - The attachment, the page, its width in CSS pixels and
 * whether it is shown at all.
 */
export function usePdfPage(input: {
  readonly id: string;
  readonly page: number;
  readonly width: number;
  readonly isWanted: boolean;
}): PdfPageState {
  const { id, page, width, isWanted } = input;
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [status, setStatus] = useState<PdfPageState["status"]>("loading");

  useEffect(() => {
    if (!isWanted) return undefined;
    let isCurrent = true;
    async function draw(): Promise<void> {
      try {
        const document = await openDocument(id);
        if (!isCurrent || canvas.current === null) return;
        setPageCount(document.pageCount);
        await document.render(
          Math.min(page, document.pageCount),
          canvas.current,
          width,
        );
        if (isCurrent) setStatus("ready");
      } catch (failure: unknown) {
        if (!isCurrent) return;
        // pdf.js names a PDF that needs a password, which is a reason of its own.
        const isLocked =
          failure instanceof Error && failure.name === "PasswordException";
        setStatus(isLocked ? "encrypted" : "failed");
      }
    }
    setStatus("loading");
    void draw();
    return () => {
      isCurrent = false;
    };
  }, [id, page, width, isWanted]);

  return { canvas, pageCount, status };
}

/** The translation key of why a PDF shows no page. */
export function pdfFailure(
  isTooLarge: boolean,
  status: PdfPageState["status"],
): string {
  if (isTooLarge) return "chat.files.unavailable.tooLarge";
  return status === "encrypted"
    ? "chat.files.unavailable.encrypted"
    : "chat.files.unavailable.failed";
}
