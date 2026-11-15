import {
  readOpenSheets,
  readOpenSlides,
  readOpenText,
} from "./open-document-reader";
import { readCsvDocument, readWorkbook } from "./sheet-reader";
import { readSlidesDocument } from "./slides-reader";
import { readWordDocument } from "./word-reader";
import { ZipReadError, openZip } from "./zip-entries";

import type { DocumentFormat } from "./document-kinds";
import type { ReadDocument } from "./document-model";
import type { ZipArchive } from "./zip-entries";

/** Why a document has no readable view. */
export type DocumentFailure = "encrypted" | "unreadable" | "tooLarge";

/** The error of a document the chat cannot show. */
export class DocumentReadError extends Error {
  public readonly reason: DocumentFailure;

  public constructor(reason: DocumentFailure) {
    super(`The document could not be read: ${reason}.`);
    this.reason = reason;
  }
}

const PACKAGE_READERS: Readonly<
  Record<
    Exclude<DocumentFormat, "csv" | "tsv">,
    (archive: ZipArchive) => Promise<ReadDocument | null>
  >
> = {
  docx: readWordDocument,
  odt: readOpenText,
  pptx: readSlidesDocument,
  odp: readOpenSlides,
  xlsx: readWorkbook,
  ods: readOpenSheets,
};

/**
 * Reads the bytes of a document in the browser as its readable view
 * (PAGE-385). No server converts the file and no new software is needed.
 *
 * @remarks
 * The content becomes plain data that the chat renders as text with its own
 * components: no script, macro or embedded program of the file runs, and
 * nothing outside the file is loaded.
 *
 * @param bytes - The whole file.
 * @param options - Its format and its name, the name of the table of a CSV file.
 * @throws {DocumentReadError} For an encrypted, damaged or too large file.
 */
export async function readDocument(
  bytes: Uint8Array,
  options: { readonly format: DocumentFormat; readonly name: string },
): Promise<ReadDocument> {
  const { format, name } = options;
  if (format === "csv" || format === "tsv")
    return readCsvDocument(bytes, { name, isTab: format === "tsv" });
  try {
    const document = await PACKAGE_READERS[format](openZip(bytes));
    if (document === null) throw new DocumentReadError("unreadable");
    return document;
  } catch (error: unknown) {
    if (error instanceof ZipReadError)
      throw new DocumentReadError(error.reason);
    if (error instanceof DocumentReadError) throw error;
    console.warn("The document could not be read.", error);
    throw new DocumentReadError("unreadable");
  }
}
