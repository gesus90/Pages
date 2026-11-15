import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";

/** A PDF opened for a preview in the browser. */
export interface PdfPreview {
  readonly pageCount: number;
  /**
   * Draws one page into a canvas.
   *
   * @param pageNumber - The page, counted from 1.
   * @param canvas - The canvas that receives the page.
   * @param width - The width the page is shown in, in CSS pixels.
   */
  render(
    pageNumber: number,
    canvas: HTMLCanvasElement,
    width: number,
  ): Promise<void>;
  /**
   * The title the metadata of the PDF names (PAGE-385).
   *
   * @returns The title, or `null` when the PDF names none.
   */
  readTitle(): Promise<string | null>;
  /**
   * The pages whose text contains a search, regardless of case (PAGE-385).
   *
   * @param query - The search text.
   * @returns The page numbers, counted from 1, in order.
   */
  findPages(query: string): Promise<number[]>;
  /** Frees the parsed document and its worker. */
  close(): void;
}

/** Reads the title of the information dictionary of a PDF. */
function titleOf(info: unknown): string | null {
  if (typeof info !== "object" || info === null || !("Title" in info))
    return null;
  const title = typeof info.Title === "string" ? info.Title.trim() : "";
  return title === "" ? null : title;
}

/** The text of a page as one string, from the items pdf.js extracts. */
function joinTextItems(items: readonly unknown[]): string {
  return items
    .map((item) =>
      typeof item === "object" &&
      item !== null &&
      "str" in item &&
      typeof item.str === "string"
        ? item.str
        : "",
    )
    .join(" ");
}

/**
 * The one pdf.js worker of the page, started with the first preview.
 *
 * @remarks
 * Vite builds the worker as a `.js` asset, which the server sends as
 * JavaScript; pdf.js would otherwise load its `.mjs` worker file.
 */
let worker: Worker | null = null;

/** The page drawn into each canvas right now; a new page cancels it first. */
const activeRenders = new WeakMap<
  HTMLCanvasElement,
  { cancel(): void; readonly promise: Promise<void> }
>();

/**
 * Opens an own PDF attachment with pdf.js for a page preview (PAGE-92).
 *
 * @remarks
 * The bytes come from the authenticated download address of Pages; see
 * {@link openPdfBytes} for how they are parsed and drawn.
 *
 * @param url - The download address of the attachment.
 * @param signal - Cancels the download.
 */
export async function openPdfPreview(
  url: string,
  signal: AbortSignal,
): Promise<PdfPreview> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("The PDF could not be loaded.");
  return openPdfBytes(new Uint8Array(await response.arrayBuffer()));
}

/**
 * Opens the bytes of a PDF with pdf.js for a page preview.
 *
 * @remarks
 * A local file goes through here, because the page may not fetch a `blob:`
 * address (`connect-src 'self'`). pdf.js parses the bytes in its worker and
 * the page is drawn into a canvas. No script of the PDF runs, forms and
 * annotations are not drawn as interactive layers, links are not followed
 * and nothing is loaded from another origin.
 *
 * @param bytes - The content of the PDF; pdf.js takes the buffer over.
 */
export async function openPdfBytes(bytes: Uint8Array): Promise<PdfPreview> {
  const pdfjs = await import("pdfjs-dist");
  worker ??= new PdfWorker();
  pdfjs.GlobalWorkerOptions.workerPort = worker;
  const task = pdfjs.getDocument({
    data: bytes,
    enableXfa: false,
    useWasm: false,
    stopAtErrors: false,
  });
  const document = await task.promise.catch((error: unknown) => {
    void task.destroy();
    throw error;
  });
  // The text of each page, read once for the search (PAGE-385).
  const pageTexts = new Map<number, string>();
  return {
    pageCount: document.numPages,
    async render(pageNumber, canvas, width) {
      const page = await document.getPage(pageNumber);
      const natural = page.getViewport({ scale: 1 });
      const scale = (width / natural.width) * (window.devicePixelRatio || 1);
      const viewport = page.getViewport({ scale });
      const previous = activeRenders.get(canvas);
      previous?.cancel();
      await previous?.promise.catch(() => undefined);
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const rendering = page.render({
        canvas,
        viewport,
        annotationMode: pdfjs.AnnotationMode.DISABLE,
      });
      activeRenders.set(canvas, rendering);
      try {
        await rendering.promise;
      } finally {
        if (activeRenders.get(canvas) === rendering)
          activeRenders.delete(canvas);
        page.cleanup();
      }
    },
    async readTitle() {
      const metadata = await document.getMetadata().catch(() => null);
      return titleOf(metadata?.info);
    },
    async findPages(query) {
      const search = query.trim().toLocaleLowerCase();
      if (search === "") return [];
      const found: number[] = [];
      for (
        let pageNumber = 1;
        pageNumber <= document.numPages;
        pageNumber += 1
      ) {
        let text = pageTexts.get(pageNumber);
        if (text === undefined) {
          const page = await document.getPage(pageNumber);
          const content = await page.getTextContent();
          text = joinTextItems(content.items).toLocaleLowerCase();
          pageTexts.set(pageNumber, text);
        }
        if (text.includes(search)) found.push(pageNumber);
      }
      return found;
    },
    close() {
      void task.destroy();
    },
  };
}
