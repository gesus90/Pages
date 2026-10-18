import { CHAT_OFFICE_TYPES } from "@/definition/ChatPreview";

import { ChatZipArchive } from "./ChatZipArchive";

import type { ChatPreviewSection } from "@/definition/ChatPreview";
import type { ChatDocument } from "./ChatDocumentReader";

/** Inflated bytes one Office part and one reading may take. */
const OFFICE_LIMITS = {
  entryBytes: 16 * 1024 * 1024,
  totalBytes: 48 * 1024 * 1024,
};

/** Slides and sheets read at most. */
const MAXIMUM_PARTS = 200;

/** Rows and columns of a sheet read at most. */
const MAXIMUM_ROWS = 1_000;
const MAXIMUM_COLUMNS = 50;

const TOKEN = /<(\/?)([A-Za-z_][\w.:-]*)([^>]*)>|([^<]+)/gu;
const ATTRIBUTE = /([\w:.-]+)="([^"]*)"/gu;
const ENTITY = /&(?:#(\d+)|#x([0-9a-fA-F]+)|(lt|gt|amp|quot|apos));/gu;
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
};

/** The element names that carry the text of one Office format. */
interface TextMarkup {
  readonly paragraph: string;
  readonly text: string;
  readonly tab: string;
  readonly lineBreak: string;
}

const WORD_MARKUP: TextMarkup = {
  paragraph: "w:p",
  text: "w:t",
  tab: "w:tab",
  lineBreak: "w:br",
};

const DRAWING_MARKUP: TextMarkup = {
  paragraph: "a:p",
  text: "a:t",
  tab: "a:tab",
  lineBreak: "a:br",
};

interface XmlToken {
  readonly isClosing: boolean;
  readonly isEmpty: boolean;
  readonly name: string;
  readonly attributes: string;
  readonly text: string | null;
}

function decodeEntities(text: string): string {
  return text.replace(
    ENTITY,
    (entity, decimal?: string, hex?: string, name?: string) => {
      if (name !== undefined) return NAMED_ENTITIES[name] ?? entity;
      const code = Number.parseInt(decimal ?? hex ?? "", decimal ? 10 : 16);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : "";
    },
  );
}

function* tokens(xml: string): Generator<XmlToken> {
  for (const match of xml.matchAll(TOKEN)) {
    const [, slash, name, attributes, text] = match;
    if (text !== undefined) {
      yield {
        isClosing: false,
        isEmpty: false,
        name: "",
        attributes: "",
        text,
      };
      continue;
    }
    yield {
      isClosing: slash === "/",
      isEmpty: attributes.trimEnd().endsWith("/"),
      name,
      attributes,
      text: null,
    };
  }
}

function attribute(attributes: string, name: string): string | null {
  for (const match of attributes.matchAll(ATTRIBUTE))
    if (match[1] === name) return decodeEntities(match[2]);
  return null;
}

/** The paragraphs of a part as plain text; markup, fields and objects are never interpreted. */
function readParagraphs(xml: string, markup: TextMarkup): string[] {
  const paragraphs: string[] = [];
  let current = "";
  let isInText = false;
  for (const token of tokens(xml)) {
    if (token.text !== null) {
      if (isInText) current += decodeEntities(token.text);
    } else if (token.name === markup.text) {
      isInText = !token.isClosing && !token.isEmpty;
    } else if (token.name === markup.tab && !token.isClosing) {
      current += "\t";
    } else if (token.name === markup.lineBreak && !token.isClosing) {
      current += "\n";
    } else if (token.name === markup.paragraph && token.isClosing) {
      paragraphs.push(current.trimEnd());
      current = "";
    }
  }
  return paragraphs;
}

function joinParagraphs(paragraphs: readonly string[]): string {
  return paragraphs
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function numbered(names: readonly string[], pattern: RegExp): string[] {
  return names
    .map((name) => ({ name, number: Number(pattern.exec(name)?.[1] ?? NaN) }))
    .filter(({ number }) => Number.isInteger(number))
    .sort((left, right) => left.number - right.number)
    .map(({ name }) => name);
}

function readWordDocument(archive: ChatZipArchive): ChatDocument {
  const xml = archive.text("word/document.xml") ?? "";
  const text = joinParagraphs(readParagraphs(xml, WORD_MARKUP));
  return {
    sections: text ? [{ kind: "document", number: 1, text }] : [],
    sheets: [],
    isTruncated: false,
  };
}

function readPresentation(archive: ChatZipArchive): ChatDocument {
  const slides = numbered(archive.names(), /^ppt\/slides\/slide(\d+)\.xml$/u);
  const sections: ChatPreviewSection[] = [];
  for (const [index, name] of slides.slice(0, MAXIMUM_PARTS).entries()) {
    const text = joinParagraphs(
      readParagraphs(archive.text(name) ?? "", DRAWING_MARKUP),
    );
    if (text) sections.push({ kind: "slide", number: index + 1, text });
  }
  return {
    sections,
    sheets: [],
    isTruncated: slides.length > MAXIMUM_PARTS,
  };
}

function readSharedStrings(archive: ChatZipArchive): string[] {
  const xml = archive.text("xl/sharedStrings.xml");
  if (xml === null) return [];
  const strings: string[] = [];
  let current = "";
  let isInText = false;
  for (const token of tokens(xml)) {
    if (token.text !== null) {
      if (isInText) current += decodeEntities(token.text);
    } else if (token.name === "t") {
      isInText = !token.isClosing && !token.isEmpty;
    } else if (token.name === "si" && token.isClosing) {
      strings.push(current);
      current = "";
    }
  }
  return strings;
}

function columnIndex(reference: string | null): number | null {
  const letters = /^([A-Z]{1,3})\d+$/u.exec(reference ?? "")?.[1];
  if (letters === undefined) return null;
  let index = 0;
  for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64;
  return index - 1;
}

/** One cell while its row is read: its column, its type and its text. */
interface CellState {
  column: number;
  type: string | null;
  value: string;
}

function cellText(cell: CellState, shared: readonly string[]): string {
  if (cell.type === "s") return shared[Number(cell.value)] ?? "";
  if (cell.type === "b") return cell.value === "1" ? "WAHR" : "FALSCH";
  return cell.value;
}

interface SheetState {
  readonly rows: string[][];
  row: string[] | null;
  cell: CellState | null;
  isInValue: boolean;
  isTruncated: boolean;
}

function readRowToken(token: XmlToken, state: SheetState): void {
  if (!token.isClosing) {
    state.row = [];
    if (token.isEmpty) state.rows.push(state.row);
    return;
  }
  if (state.row) state.rows.push(state.row);
  state.row = null;
}

function readCellToken(
  token: XmlToken,
  state: SheetState,
  shared: readonly string[],
): void {
  if (!token.isClosing) {
    if (token.isEmpty) return;
    state.cell = {
      column:
        columnIndex(attribute(token.attributes, "r")) ?? state.row?.length ?? 0,
      type: attribute(token.attributes, "t"),
      value: "",
    };
    return;
  }
  const { cell, row } = state;
  state.cell = null;
  if (!cell || !row) return;
  if (cell.column < MAXIMUM_COLUMNS) row[cell.column] = cellText(cell, shared);
  else state.isTruncated = true;
}

function readSheetToken(
  token: XmlToken,
  state: SheetState,
  shared: readonly string[],
): void {
  if (token.text !== null) {
    if (state.isInValue && state.cell)
      state.cell.value += decodeEntities(token.text);
    return;
  }
  if (token.name === "row") readRowToken(token, state);
  else if (token.name === "c") readCellToken(token, state, shared);
  else if (token.name === "v" || token.name === "t")
    state.isInValue = !token.isClosing && !token.isEmpty;
}

function readSheet(
  xml: string,
  shared: readonly string[],
): { readonly rows: string[][]; readonly isTruncated: boolean } {
  const state: SheetState = {
    rows: [],
    row: null,
    cell: null,
    isInValue: false,
    isTruncated: false,
  };
  for (const token of tokens(xml)) {
    readSheetToken(token, state, shared);
    if (state.rows.length >= MAXIMUM_ROWS) {
      state.isTruncated = true;
      break;
    }
  }
  return {
    rows: state.rows.map((row) => Array.from(row, (cell) => cell ?? "")),
    isTruncated: state.isTruncated,
  };
}

/** The internal part each relationship of the workbook points to; external targets are left out. */
function relationTargets(relations: string): ReadonlyMap<string, string> {
  const targets = new Map<string, string>();
  for (const token of tokens(relations)) {
    if (token.name !== "Relationship" || token.isClosing) continue;
    if (attribute(token.attributes, "TargetMode") === "External") continue;
    const id = attribute(token.attributes, "Id");
    const target = attribute(token.attributes, "Target");
    if (!id || !target) continue;
    targets.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  }
  return targets;
}

/** Sheet names and parts in the order of the workbook. */
function sheetParts(
  archive: ChatZipArchive,
): { readonly name: string; readonly part: string }[] {
  const targets = relationTargets(
    archive.text("xl/_rels/workbook.xml.rels") ?? "",
  );
  const parts: { name: string; part: string }[] = [];
  for (const token of tokens(archive.text("xl/workbook.xml") ?? "")) {
    if (token.name !== "sheet" || token.isClosing) continue;
    const part = targets.get(attribute(token.attributes, "r:id") ?? "");
    if (part)
      parts.push({ name: attribute(token.attributes, "name") ?? "", part });
  }
  return parts;
}

function readWorkbook(archive: ChatZipArchive): ChatDocument {
  const shared = readSharedStrings(archive);
  const parts = sheetParts(archive);
  const sheets: { name: string; rows: string[][] }[] = [];
  let isTruncated = parts.length > MAXIMUM_PARTS;
  for (const { name, part } of parts.slice(0, MAXIMUM_PARTS)) {
    const sheet = readSheet(archive.text(part) ?? "", shared);
    isTruncated ||= sheet.isTruncated;
    sheets.push({ name, rows: sheet.rows });
  }
  return { sections: [], sheets, isTruncated };
}

/**
 * Reads the text of an accepted Office file: a Word document, the slides of a
 * presentation or the sheets of a workbook (PAGE-92).
 *
 * @remarks
 * Only the XML parts that hold text are read, in memory and within fixed
 * inflation limits. Relationships to external targets, linked or embedded
 * objects, fields and macros are never followed or run; macro packages are
 * refused at the upload already.
 *
 * @throws {ChatZipError} For an encrypted, damaged or too large package.
 */
export function readOfficeDocument(
  contentType: string,
  bytes: Buffer,
): ChatDocument | null {
  const archive = new ChatZipArchive(bytes, OFFICE_LIMITS);
  if (contentType === CHAT_OFFICE_TYPES.document)
    return readWordDocument(archive);
  if (contentType === CHAT_OFFICE_TYPES.presentation)
    return readPresentation(archive);
  if (contentType === CHAT_OFFICE_TYPES.workbook) return readWorkbook(archive);
  return null;
}
