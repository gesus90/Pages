import {
  OFFICE_LIMITS,
  attribute,
  decodeEntities,
  tokens,
} from "./ChatOfficeText";
import { ChatZipArchive } from "./ChatZipArchive";

import type { ChatPreviewSection } from "@/definition/ChatPreview";
import type { ChatDocument, ChatDocumentSheet } from "./ChatDocumentReader";
import type { XmlToken } from "./ChatOfficeText";

/** Which OpenDocument format a package holds (PAGE-386). */
export type OpenDocumentFormat = "text" | "presentation" | "spreadsheet";

/** Slides and sheets read at most, as for Office files. */
const MAXIMUM_PARTS = 200;
/** Rows and columns of a sheet read at most, as for Office files. */
const MAXIMUM_ROWS = 1_000;
const MAXIMUM_COLUMNS = 50;

/** The elements whose character data is text of the document. */
const TEXT_BLOCKS: ReadonlySet<string> = new Set(["text:p", "text:h"]);

/** Collects the paragraphs of a run of tokens: character data inside `text:p` and `text:h`. */
class ParagraphCollector {
  private depth = 0;
  private current = "";
  private readonly paragraphs: string[] = [];

  /** Takes one token of the part. */
  public take(token: XmlToken): void {
    if (token.text !== null) {
      if (this.depth > 0) this.current += decodeEntities(token.text);
      return;
    }
    if (TEXT_BLOCKS.has(token.name)) {
      if (token.isEmpty) return;
      this.depth += token.isClosing ? -1 : 1;
      if (token.isClosing && this.depth === 0) this.flush();
      return;
    }
    if (this.depth === 0 || token.isClosing) return;
    if (token.name === "text:tab") this.current += "\t";
    else if (token.name === "text:line-break") this.current += "\n";
    else if (token.name === "text:s")
      this.current += " ".repeat(
        Math.min(Number(attribute(token.attributes, "text:c") ?? "1") || 1, 100),
      );
  }

  /** The text of the paragraphs taken so far, and starts anew. */
  public text(): string {
    this.flush();
    const text = this.paragraphs
      .join("\n")
      .replace(/\n{3,}/gu, "\n\n")
      .trim();
    this.paragraphs.length = 0;
    return text;
  }

  private flush(): void {
    if (this.current.trim() !== "") this.paragraphs.push(this.current.trimEnd());
    this.current = "";
  }
}

/**
 * The text of a text document; split into numbered pages where the layout
 * marked page breaks (`text:soft-page-break`), otherwise one section.
 */
function readText(xml: string): ChatDocument {
  const collector = new ParagraphCollector();
  const pages: string[] = [];
  for (const token of tokens(xml)) {
    if (token.name === "text:soft-page-break") {
      pages.push(collector.text());
      continue;
    }
    collector.take(token);
  }
  pages.push(collector.text());
  const filled = pages.filter((page) => page !== "");
  const sections: ChatPreviewSection[] =
    filled.length > 1
      ? filled.map((text, index) => ({ kind: "page", number: index + 1, text }))
      : filled.map((text) => ({ kind: "document", number: 1, text }));
  return { sections, sheets: [], isTruncated: false };
}

/** The slides of a presentation, one `draw:page` each, numbered in their order. */
function readPresentation(xml: string): ChatDocument {
  const collector = new ParagraphCollector();
  const sections: ChatPreviewSection[] = [];
  let number = 0;
  let isTruncated = false;
  for (const token of tokens(xml)) {
    if (token.name === "draw:page" && token.text === null) {
      if (!token.isClosing) {
        number += 1;
        collector.text();
        continue;
      }
      const text = collector.text();
      if (number > MAXIMUM_PARTS) isTruncated = true;
      else if (text) sections.push({ kind: "slide", number, text });
      continue;
    }
    collector.take(token);
  }
  return { sections, sheets: [], isTruncated };
}

/** The repetition count of a row or cell, bounded so an empty filler stays cheap. */
function repeated(token: XmlToken, name: string, maximum: number): number {
  const count = Number(attribute(token.attributes, name) ?? "1");
  return Number.isInteger(count) && count > 1 ? Math.min(count, maximum) : 1;
}

/** Drops the empty cells at the end of a row. */
function trimRow(row: readonly string[]): string[] {
  let end = row.length;
  while (end > 0 && row[end - 1] === "") end -= 1;
  return row.slice(0, end);
}

/** Reads the rows of the sheets of a spreadsheet; repeated empty rows and cells collapse. */
class SheetCollector {
  public readonly sheets: ChatDocumentSheet[] = [];
  public isTruncated = false;
  private rows: string[][] = [];
  private row: string[] = [];
  private rowRepeat = 1;
  private cellRepeat = 1;
  private cell: ParagraphCollector | null = null;
  private name = "";

  /** Takes one token of the content part. */
  public take(token: XmlToken): void {
    if (this.cell && !this.isCellEnd(token)) {
      this.cell.take(token);
      return;
    }
    if (token.text !== null) return;
    if (token.name === "table:table") this.table(token);
    else if (token.name === "table:table-row") this.tableRow(token);
    else if (
      token.name === "table:table-cell" ||
      token.name === "table:covered-table-cell"
    )
      this.tableCell(token);
  }

  private isCellEnd(token: XmlToken): boolean {
    return (
      token.text === null &&
      token.isClosing &&
      (token.name === "table:table-cell" ||
        token.name === "table:covered-table-cell")
    );
  }

  private table(token: XmlToken): void {
    if (!token.isClosing) {
      this.name = attribute(token.attributes, "table:name") ?? "";
      this.rows = [];
      return;
    }
    if (this.sheets.length >= MAXIMUM_PARTS) {
      this.isTruncated = true;
      return;
    }
    while (this.rows.length > 0 && this.rows.at(-1)?.length === 0)
      this.rows.pop();
    this.sheets.push({ name: this.name, rows: this.rows });
  }

  private tableRow(token: XmlToken): void {
    if (!token.isClosing) {
      this.row = [];
      this.rowRepeat = repeated(token, "table:number-rows-repeated", MAXIMUM_ROWS);
      if (token.isEmpty) this.endRow();
      return;
    }
    this.endRow();
  }

  private endRow(): void {
    const row = trimRow(this.row);
    const count = row.length === 0 ? 1 : this.rowRepeat;
    for (let index = 0; index < count; index += 1) {
      if (this.rows.length >= MAXIMUM_ROWS) {
        if (row.length > 0) this.isTruncated = true;
        return;
      }
      this.rows.push([...row]);
    }
  }

  private tableCell(token: XmlToken): void {
    if (token.isClosing) {
      this.endCell(this.cell?.text() ?? "");
      this.cell = null;
      return;
    }
    this.cellRepeat = repeated(
      token,
      "table:number-columns-repeated",
      MAXIMUM_COLUMNS,
    );
    if (token.isEmpty) {
      this.endCell("");
      return;
    }
    this.cell = new ParagraphCollector();
  }

  private endCell(text: string): void {
    for (let index = 0; index < this.cellRepeat; index += 1)
      if (this.row.length < MAXIMUM_COLUMNS) this.row.push(text);
  }
}

function readSpreadsheet(xml: string): ChatDocument {
  const collector = new SheetCollector();
  for (const token of tokens(xml)) collector.take(token);
  return {
    sections: [],
    sheets: collector.sheets,
    isTruncated: collector.isTruncated,
  };
}

/**
 * Reads the text of an OpenDocument file (PAGE-386): the pages of a text
 * document, the slides of a presentation or the sheets of a spreadsheet.
 *
 * @remarks
 * Only `content.xml` is read, in memory and within the same inflation limits
 * as Office files. Scripts, macros (`Basic/`, `Scripts/`), embedded objects
 * and links are never read, followed or run; markup is never interpreted.
 *
 * @param format - Which OpenDocument format the file holds.
 * @param bytes - The complete package.
 * @throws {ChatZipError} For an encrypted, damaged or too large package.
 */
export function readOpenDocument(
  format: OpenDocumentFormat,
  bytes: Buffer,
): ChatDocument {
  const archive = new ChatZipArchive(bytes, OFFICE_LIMITS);
  const xml = archive.text("content.xml") ?? "";
  if (format === "presentation") return readPresentation(xml);
  if (format === "spreadsheet") return readSpreadsheet(xml);
  return readText(xml);
}
