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
  /** Frees the parsed document and its worker. */
  close(): void;
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
 * The bytes come from the authenticated download address of Pages and are
 * parsed by pdf.js in its worker; the page is drawn into a canvas. No script
 * of the PDF runs, forms and annotations are not drawn as interactive layers,
 * links are not followed and nothing is loaded from another origin.
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
  const bytes = new Uint8Array(await response.arrayBuffer());
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
    close() {
      void task.destroy();
    },
  };
}
