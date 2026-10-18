import type { ChatPreviewSection } from "@/definition/ChatPreview";
import type { ChatDocumentReading } from "./ChatDocumentReader";

/** Pages of a PDF that are read at most. */
const MAXIMUM_PAGES = 200;

/** Characters of all pages that are read at most; the reader cuts further. */
const MAXIMUM_CHARACTERS = 400_000;

/** How long reading one PDF may take before it ends as too large. */
const DEADLINE_MILLISECONDS = 20_000;

/** The parts of the result of `getTextContent` that hold text. */
interface PdfTextItem {
  readonly str: string;
  readonly hasEOL?: boolean;
}

function isTextItem(item: unknown): item is PdfTextItem {
  return (
    typeof item === "object" &&
    item !== null &&
    typeof Reflect.get(item, "str") === "string"
  );
}

function failureName(error: unknown): string {
  return typeof error === "object" && error !== null
    ? String(Reflect.get(error, "name"))
    : "";
}

function pageText(items: readonly unknown[]): string {
  return items
    .filter(isTextItem)
    .map((item) => `${item.str}${item.hasEOL === true ? "\n" : ""}`)
    .join("")
    .replace(/[ \t]+\n/gu, "\n")
    .trim();
}

/**
 * Reads the text layer of a PDF with pdf.js (PAGE-92).
 *
 * @remarks
 * pdf.js parses the file without running its scripts (pdf.js 6 has no `eval`
 * path), without fonts of the system, WebAssembly or fetches; forms,
 * links and embedded files are not followed. Pages, characters and time are
 * bounded. A scanned PDF without a text layer reads as `noText`, a PDF with a
 * password as `encrypted`.
 *
 * @param bytes - The complete file.
 * @returns The pages with text, or why there is none.
 */
export async function readPdfDocument(
  bytes: Buffer,
): Promise<ChatDocumentReading> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const deadline = Date.now() + DEADLINE_MILLISECONDS;
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    useWasm: false,
    useWorkerFetch: false,
    useSystemFonts: false,
    enableXfa: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  try {
    const document = await task.promise;
    const total = document.numPages;
    const sections: ChatPreviewSection[] = [];
    let characters = 0;
    let read = 0;
    for (
      let number = 1;
      number <= Math.min(total, MAXIMUM_PAGES);
      number += 1
    ) {
      if (Date.now() > deadline || characters > MAXIMUM_CHARACTERS) break;
      const page = await document.getPage(number);
      const text = pageText((await page.getTextContent()).items);
      page.cleanup();
      read = number;
      characters += text.length;
      if (text) sections.push({ kind: "page", number, text });
    }
    if (read > 0 && sections.length === 0 && read === total)
      return { status: "noText" };
    if (sections.length === 0)
      return { status: read === 0 ? "tooLarge" : "noText" };
    return {
      status: "read",
      document: {
        sections,
        sheets: [],
        pages: { read, total },
        isTruncated: read < total,
      },
    };
  } catch (caughtError: unknown) {
    if (failureName(caughtError) === "PasswordException")
      return { status: "encrypted" };
    return { status: "unreadable" };
  } finally {
    await task.destroy();
  }
}
