import { redactCredentials } from "@/backend/security/AgentTextSafety";
import {
  chatDocumentText,
  readChatDocument,
} from "@/backend/service/chat/ChatDocumentReader";
import {
  OFFICE_LIMITS,
  officeMediaNames,
  readOfficeDocument,
} from "@/backend/service/chat/ChatOfficeText";
import { readOpenDocument } from "@/backend/service/chat/ChatOpenDocumentText";
import { readPdfPageImages } from "@/backend/service/chat/ChatPdfImages";
import {
  ChatZipArchive,
  ChatZipError,
} from "@/backend/service/chat/ChatZipArchive";
import { CHAT_OFFICE_TYPES } from "@/definition/ChatPreview";

import { attachmentExtension } from "./ConversationAttachmentKinds";
import {
  readDelimitedSheet,
  sheetWindow,
  sheetsSearchText,
} from "./ConversationSheetText";

import type {
  ChatDocument,
  ChatDocumentReading,
} from "@/backend/service/chat/ChatDocumentReader";
import type { ChatPreviewSection } from "@/definition/ChatPreview";
import type { AgentAttachmentKind } from "./ConversationAttachmentKinds";

/** Characters of text one reading returns at most (PAGE-386). */
export const AGENT_READ_CHARACTERS = 30_000;

/** Characters of recognized text Pages keeps for the search of a chat. */
export const AGENT_SEARCH_CHARACTERS = 400_000;

/** An image an agent receives from a reading. */
export interface AgentReadImage {
  /** What the image is, such as `Bild 2 aus dem Dokument`. */
  readonly label: string;
  readonly mimeType: string;
  readonly data: Buffer;
}

/** What one reading of an attachment yields (PAGE-386). */
export interface AgentAttachmentReading {
  /** The fields of the tool result; every text is data, credentials redacted. */
  readonly result: Readonly<Record<string, unknown>>;
  readonly images: readonly AgentReadImage[];
  /** The recognized text Pages keeps for the search; `null` keeps none. */
  readonly searchText: string | null;
}

/** Which part of an attachment an agent reads. */
export interface AgentAttachmentReadRequest {
  /** The first and last page, slide or line, counted from 1. */
  readonly from?: number;
  readonly to?: number;
  /** The sheet of a table by name. */
  readonly sheet?: string;
  /** The first data row of a table, counted from 1 below the header row. */
  readonly fromRow?: number;
  /** An embedded image by number, or for a PDF the page whose images are read. */
  readonly image?: number;
}

/** What the reading of a document uses; the readers of Pages by default. */
export interface DocumentReaders {
  readonly pdfImages?: (bytes: Buffer, page: number) => Promise<Buffer[]>;
}

const MEDIA_TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const UNAVAILABLE_TEXTS: Readonly<Record<string, string>> = {
  unsupported: "Pages kann den Text dieses Formats nicht lesen.",
  tooLarge: "Das Dokument ist zu groß, um es zu lesen.",
  encrypted:
    "Das Dokument ist verschlüsselt oder mit einem Passwort geschützt.",
  noText:
    "Das Dokument enthält keinen lesbaren Text (vielleicht ein Scan); Bilder lassen sich mit `bild` lesen.",
  unreadable: "Das Dokument ist beschädigt oder unlesbar.",
};

/** The Office type of an OOXML file by its kind, macro variants included. */
function officeType(kind: AgentAttachmentKind): string {
  if (kind === "slides") return CHAT_OFFICE_TYPES.presentation;
  if (kind === "sheet") return CHAT_OFFICE_TYPES.workbook;
  return CHAT_OFFICE_TYPES.document;
}

function openDocumentKind(
  kind: AgentAttachmentKind,
): "presentation" | "spreadsheet" | "text" {
  if (kind === "slides") return "presentation";
  if (kind === "sheet") return "spreadsheet";
  return "text";
}

/**
 * Reads the text of a document of any supported format: PDF, Word, PowerPoint,
 * Excel and their OpenDocument counterparts, CSV and TSV.
 */
async function readAnyDocument(
  name: string,
  kind: AgentAttachmentKind,
  bytes: Buffer,
): Promise<ChatDocumentReading> {
  const extension = attachmentExtension(name);
  if (kind === "pdf") return readChatDocument("application/pdf", bytes);
  if (extension === ".csv" || extension === ".tsv") {
    const { sheet, isTruncated } = readDelimitedSheet(
      bytes.toString("utf8"),
      extension === ".tsv",
    );
    return {
      status: "read",
      document: { sections: [], sheets: [sheet], isTruncated },
    };
  }
  try {
    const document = extension.startsWith(".od")
      ? readOpenDocument(openDocumentKind(kind), bytes)
      : readOfficeDocument(officeType(kind), bytes);
    if (document === null) return { status: "unsupported" };
    const isEmpty =
      document.sections.length === 0 &&
      document.sheets.every((sheet) => sheet.rows.length === 0);
    return isEmpty ? { status: "noText" } : { status: "read", document };
  } catch (error: unknown) {
    return {
      status: error instanceof ChatZipError ? error.reason : "unreadable",
    };
  }
}

function heading(section: ChatPreviewSection): string {
  if (section.kind === "page") return `Seite ${String(section.number)}`;
  if (section.kind === "slide") return `Folie ${String(section.number)}`;
  return "Text";
}

/** The sections between two numbers, within the character limit, and where to read on. */
function sectionWindow(
  sections: readonly ChatPreviewSection[],
  request: AgentAttachmentReadRequest,
): {
  readonly parts: { readonly ort: string; readonly text: string }[];
  readonly next: number | null;
} {
  const from = Math.max(1, request.from ?? 1);
  const to = request.to ?? Number.MAX_SAFE_INTEGER;
  const parts: { ort: string; text: string }[] = [];
  let characters = 0;
  for (const section of sections) {
    if (section.number < from || section.number > to) continue;
    const text = redactCredentials(section.text);
    if (parts.length > 0 && characters + text.length > AGENT_READ_CHARACTERS)
      return { parts, next: section.number };
    characters += text.length;
    parts.push({
      ort: heading(section),
      text: Array.from(text).slice(0, AGENT_READ_CHARACTERS).join(""),
    });
  }
  return { parts, next: null };
}

/** The pictures of a package by number, or why the number has none. */
function embeddedImage(bytes: Buffer, number: number): AgentReadImage | string {
  const names = officeMediaNames(bytes);
  const name = names[number - 1];
  if (name === undefined)
    return `Das Dokument hat ${String(names.length)} eingebettete Bilder; Bild ${String(number)} gibt es nicht.`;
  const imageBytes = new ChatZipArchive(bytes, OFFICE_LIMITS).bytes(name);
  const mimeType = MEDIA_TYPES[attachmentExtension(name)];
  if (!imageBytes || !mimeType) return "Das Bild ließ sich nicht lesen.";
  return {
    label: `Bild ${String(number)} aus dem Dokument`,
    mimeType,
    data: imageBytes,
  };
}

/** The images a request asks for: a picture of a package, or the images of a PDF page. */
async function requestedImages(
  input: {
    readonly kind: AgentAttachmentKind;
    readonly bytes: Buffer;
    readonly number: number;
  },
  readers: DocumentReaders,
): Promise<{
  readonly images: AgentReadImage[];
  readonly note: string | null;
}> {
  if (input.kind === "pdf") {
    const read = readers.pdfImages ?? readPdfPageImages;
    const pngs = await read(input.bytes, input.number);
    if (pngs.length === 0)
      return {
        images: [],
        note: `Auf Seite ${String(input.number)} ließen sich keine Bilder lesen.`,
      };
    return {
      images: pngs.map((png, index) => ({
        label: `Bild ${String(index + 1)} auf Seite ${String(input.number)}`,
        mimeType: "image/png",
        data: png,
      })),
      note: null,
    };
  }
  const image = embeddedImage(input.bytes, input.number);
  return typeof image === "string"
    ? { images: [], note: image }
    : { images: [image], note: null };
}

function sheetResult(
  document: ChatDocument,
  request: AgentAttachmentReadRequest,
): Readonly<Record<string, unknown>> {
  const blaetter = document.sheets.map((sheet) => ({
    name: sheet.name,
    zeilen: Math.max(0, sheet.rows.length - 1),
    spalten: Math.max(0, ...sheet.rows.map((row) => row.length)),
  }));
  const window = sheetWindow(document.sheets, {
    ...(request.sheet === undefined ? {} : { sheet: request.sheet }),
    ...(request.fromRow === undefined ? {} : { fromRow: request.fromRow }),
  });
  if (!window)
    return {
      blaetter,
      hinweis: `Ein Blatt „${request.sheet ?? ""}“ gibt es nicht.`,
    };
  const redact = (cells: readonly string[]): string[] =>
    cells.map(redactCredentials);
  return {
    blaetter,
    blatt: window.sheet,
    kopfzeile: redact(window.header),
    zeilen: window.rows.map((row) => ({
      nr: row.number,
      werte: redact(row.cells),
    })),
    zeilenGesamt: window.totalRows,
    spaltenGesamt: window.totalColumns,
    naechsteZeile: window.nextRow,
    ...(window.nextRow === null
      ? {}
      : {
          hinweis: `Gezeigt sind ${String(window.rows.length)} von ${String(window.totalRows)} Zeilen. Weitere mit zeileAb ${String(window.nextRow)}.`,
        }),
    ...(document.isTruncated
      ? {
          begrenzt:
            "Die Tabelle ist größer als das, was Pages liest; weitere Zeilen oder Blätter fehlen.",
        }
      : {}),
  };
}

function documentResult(
  document: ChatDocument,
  kind: AgentAttachmentKind,
  request: AgentAttachmentReadRequest,
): Readonly<Record<string, unknown>> {
  const window = sectionWindow(document.sections, request);
  const unit = kind === "slides" ? "folien" : "seiten";
  const count = document.pages?.total ?? document.sections.at(-1)?.number ?? 0;
  return {
    [unit]: count,
    abschnitte: window.parts,
    ...(window.next === null
      ? {}
      : {
          weiterAb: window.next,
          hinweis: `Begrenzt auf ${String(AGENT_READ_CHARACTERS)} Zeichen; weiter mit von ${String(window.next)}.`,
        }),
    ...(document.isTruncated
      ? {
          begrenzt:
            "Das Dokument ist länger als das, was Pages liest; spätere Teile fehlen.",
        }
      : {}),
  };
}

/**
 * Reads a PDF, a Word, PowerPoint or OpenDocument file or a table for an agent
 * (PAGE-386): text by numbered pages or slides, tables as header and rows,
 * embedded pictures as images on request.
 *
 * @remarks
 * Only the parts that hold text and pictures are read; macros, scripts,
 * embedded programs and links are never run or followed.
 *
 * @param input - Name, kind and bytes of the file, and which part is asked for.
 * @param readers - The readers of embedded images; those of Pages by default.
 */
export async function readDocumentForAgent(
  input: {
    readonly name: string;
    readonly kind: AgentAttachmentKind;
    readonly bytes: Buffer;
    readonly request: AgentAttachmentReadRequest;
  },
  readers: DocumentReaders = {},
): Promise<AgentAttachmentReading> {
  const { name, kind, bytes, request } = input;
  if (request.image !== undefined) {
    const found = await requestedImages(
      { kind, bytes, number: request.image },
      readers,
    );
    return {
      result:
        found.note === null
          ? { bilder: found.images.map((image) => image.label) }
          : { hinweis: found.note },
      images: found.images,
      searchText: null,
    };
  }
  const reading = await readAnyDocument(name, kind, bytes);
  if (reading.status !== "read")
    return {
      result: {
        hinweis:
          UNAVAILABLE_TEXTS[reading.status] ?? UNAVAILABLE_TEXTS.unreadable,
      },
      images: [],
      searchText: null,
    };
  const { document } = reading;
  const pictures = kind === "pdf" ? 0 : officeMediaNames(bytes).length;
  const result =
    kind === "sheet"
      ? sheetResult(document, request)
      : documentResult(document, kind, request);
  const searchText =
    kind === "sheet"
      ? sheetsSearchText(document.sheets)
      : chatDocumentText(document, AGENT_SEARCH_CHARACTERS).text;
  return {
    result: {
      ...result,
      ...(pictures > 0 ? { eingebetteteBilder: pictures } : {}),
      ...(kind === "pdf"
        ? {
            bilderLesen: "Bilder einer Seite liest du mit bild = Seitennummer.",
          }
        : {}),
    },
    images: [],
    searchText: Array.from(redactCredentials(searchText))
      .slice(0, AGENT_SEARCH_CHARACTERS)
      .join(""),
  };
}
