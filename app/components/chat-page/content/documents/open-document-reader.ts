import {
  MAXIMUM_BLOCKS,
  MAXIMUM_SHEETS,
  MAXIMUM_SHEET_COLUMNS,
  MAXIMUM_SHEET_ROWS,
  MAXIMUM_SLIDES,
  mergeRuns,
  runsText,
} from "./document-model";
import { PackageImages } from "./office-package";
import { sheetOf } from "./sheet-reader";
import {
  attributeOf,
  childNamed,
  childrenNamed,
  descendantNamed,
  descendantsNamed,
  parseXml,
  textOf,
} from "./xml-nodes";

import type {
  DocumentBlock,
  DocumentRun,
  Sheet,
  SheetCell,
  SheetDocument,
  Slide,
  SlidesDocument,
  WordDocument,
} from "./document-model";
import type { ZipArchive } from "./zip-entries";

const EMPTY_CELL: SheetCell = { text: "", number: null };
const NUMERIC_TYPES: readonly string[] = ["float", "percentage", "currency"];

/** The emphasis and list kinds the styles of an OpenDocument file define, by style name. */
interface OpenStyles {
  readonly text: ReadonlyMap<string, Omit<DocumentRun, "text">>;
  /** Whether a list style counts instead of using bullets. */
  readonly orderedLists: ReadonlyMap<string, boolean>;
  /** Paragraph styles that are headings, with their level. */
  readonly headings: ReadonlyMap<string, number>;
}

interface OpenContext {
  readonly styles: OpenStyles;
  readonly images: PackageImages;
  readonly blocks: DocumentBlock[];
  pageBreaks: number;
}

function textStyle(style: Element): Omit<DocumentRun, "text"> | null {
  const properties = childNamed(style, "text-properties");
  if (!properties) return null;
  const underline = attributeOf(properties, "text-underline-style");
  const strike = attributeOf(properties, "text-line-through-style");
  return {
    ...(attributeOf(properties, "font-weight") === "bold"
      ? { isBold: true }
      : {}),
    ...(attributeOf(properties, "font-style") === "italic"
      ? { isItalic: true }
      : {}),
    ...(underline !== null && underline !== "none"
      ? { isUnderline: true }
      : {}),
    ...(strike !== null && strike !== "none" ? { isStrike: true } : {}),
  };
}

/** Reads the styles of `content.xml` and `styles.xml` together. */
function readStyles(roots: readonly Element[]): OpenStyles {
  const text = new Map<string, Omit<DocumentRun, "text">>();
  const orderedLists = new Map<string, boolean>();
  const headings = new Map<string, number>();
  for (const root of roots) {
    for (const style of descendantsNamed(root, "style")) {
      const name = attributeOf(style, "name") ?? "";
      const emphasis = textStyle(style);
      if (emphasis) text.set(name, emphasis);
      const level = Number(attributeOf(style, "default-outline-level") ?? "");
      if (Number.isInteger(level) && level > 0) headings.set(name, level);
    }
    for (const list of descendantsNamed(root, "list-style")) {
      const first = list.firstElementChild;
      orderedLists.set(
        attributeOf(list, "name") ?? "",
        first?.localName === "list-level-style-number",
      );
    }
  }
  return { text, orderedLists, headings };
}

function readSpanElement(
  element: Element,
  context: OpenContext,
  inherited: Omit<DocumentRun, "text">,
): DocumentRun[] {
  switch (element.localName) {
    case "s":
      return [
        {
          ...inherited,
          text: " ".repeat(Number(attributeOf(element, "c") ?? "1") || 1),
        },
      ];
    case "tab":
      return [{ ...inherited, text: "\t" }];
    case "line-break":
      return [{ ...inherited, text: "\n" }];
    case "soft-page-break":
      context.pageBreaks += 1;
      return [];
    case "span": {
      const style = context.styles.text.get(
        attributeOf(element, "style-name") ?? "",
      );
      return readSpans(element, context, { ...inherited, ...style });
    }
    case "a": {
      const href = attributeOf(element, "href") ?? "";
      return readSpans(element, context, {
        ...inherited,
        ...(href === "" ? {} : { link: href }),
      });
    }
    default:
      return [];
  }
}

/** The runs of a paragraph or heading: spans, links, spaces, tabs and line breaks. */
function readSpans(
  parent: Element,
  context: OpenContext,
  inherited: Omit<DocumentRun, "text">,
): DocumentRun[] {
  const runs: DocumentRun[] = [];
  for (const node of parent.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      runs.push({ ...inherited, text: node.textContent ?? "" });
    } else if (node instanceof Element) {
      runs.push(...readSpanElement(node, context, inherited));
    }
  }
  return runs;
}

/** Images and embedded objects of frames; only pictures inside the file are read. */
async function readFrameList(
  frames: readonly Element[],
  context: OpenContext,
): Promise<void> {
  for (const frame of frames) {
    const description =
      textOf(childNamed(frame, "desc")) || (attributeOf(frame, "name") ?? "");
    const image = childNamed(frame, "image");
    const href = attributeOf(image, "href") ?? "";
    if (
      childNamed(frame, "object") ||
      childNamed(frame, "object-ole") ||
      childNamed(frame, "plugin")
    )
      context.blocks.push({ kind: "embedded", description });
    // An address with a scheme or an absolute path points outside the file and is never loaded.
    if (href === "" || /^[a-z][\w+.-]*:|^\/|^\.\./iu.test(href)) continue;
    const imageId = await context.images.add(href.replace(/^\.\//u, ""));
    if (imageId !== null)
      context.blocks.push({ kind: "image", imageId, description });
  }
}

/** Images and embedded objects of the frames inside an element. */
function readFrames(parent: Element, context: OpenContext): Promise<void> {
  return readFrameList(descendantsNamed(parent, "frame"), context);
}

async function readParagraph(
  element: Element,
  context: OpenContext,
  list: { readonly isOrdered: boolean; readonly level: number } | null,
): Promise<void> {
  const styleName = attributeOf(element, "style-name") ?? "";
  const runs = mergeRuns(
    readSpans(element, context, context.styles.text.get(styleName) ?? {}),
  );
  const breaksBefore = context.pageBreaks;
  const outline = Number(
    attributeOf(element, "outline-level") ??
      context.styles.headings.get(styleName) ??
      "",
  );
  if (runs.length > 0) {
    if (
      element.localName === "h" ||
      (Number.isInteger(outline) && outline > 0 && list === null)
    )
      context.blocks.push({
        kind: "heading",
        level: Math.min(Math.max(outline || 1, 1), 6),
        runs,
      });
    else if (list) context.blocks.push({ kind: "listItem", ...list, runs });
    else context.blocks.push({ kind: "paragraph", runs });
  }
  await readFrames(element, context);
  for (let index = breaksBefore; index < context.pageBreaks; index += 1)
    context.blocks.push({ kind: "pageBreak" });
}

async function readList(
  list: Element,
  context: OpenContext,
  level: number,
  inheritedOrdered: boolean | null,
): Promise<void> {
  const style = attributeOf(list, "style-name");
  const isOrdered =
    (style === null ? null : context.styles.orderedLists.get(style)) ??
    inheritedOrdered ??
    false;
  for (const item of childrenNamed(list, "list-item", "list-header")) {
    for (const child of item.children) {
      if (child.localName === "list")
        await readList(child, context, level + 1, isOrdered);
      else if (child.localName === "p" || child.localName === "h")
        await readParagraph(child, context, { isOrdered, level });
    }
  }
}

function expandTableRow(row: Element): Element[] {
  const cells: Element[] = [];
  for (const cell of childrenNamed(row, "table-cell", "covered-table-cell")) {
    const repeat = Math.min(
      Number(attributeOf(cell, "number-columns-repeated") ?? "1") || 1,
      MAXIMUM_SHEET_COLUMNS,
    );
    for (let index = 0; index < repeat; index += 1) cells.push(cell);
  }
  return cells;
}

/** The rows of an OpenDocument table, repeated rows and cells expanded within the limits. */
function tableRows(table: Element): Element[][] {
  const rows: Element[][] = [];
  const containers = [
    table,
    ...childrenNamed(
      table,
      "table-header-rows",
      "table-rows",
      "table-row-group",
    ),
  ];
  for (const container of containers)
    for (const row of childrenNamed(container, "table-row")) {
      rows.push(expandTableRow(row));
    }
  return rows;
}

function readTextTable(table: Element, context: OpenContext): void {
  const rows = tableRows(table).map((cells) =>
    cells.map((cell) => {
      const runs: DocumentRun[] = [];
      for (const paragraph of descendantsNamed(cell, "p")) {
        if (runs.length > 0) runs.push({ text: "\n" });
        runs.push(...readSpans(paragraph, context, {}));
      }
      return mergeRuns(runs);
    }),
  );
  if (rows.length > 0) context.blocks.push({ kind: "table", rows });
}

async function readTextBody(
  body: Element,
  context: OpenContext,
): Promise<void> {
  for (const child of body.children) {
    if (context.blocks.length >= MAXIMUM_BLOCKS) return;
    const name = child.localName;
    if (name === "p" || name === "h") await readParagraph(child, context, null);
    else if (name === "list") await readList(child, context, 0, null);
    else if (name === "table") readTextTable(child, context);
    else if (name === "section" || name === "text-box")
      await readTextBody(child, context);
  }
}

interface OpenParts {
  readonly content: Element;
  readonly styles: OpenStyles;
  readonly meta: Element | null;
}

async function readParts(archive: ZipArchive): Promise<OpenParts | null> {
  const contentText = await archive.readText("content.xml");
  const content = contentText === null ? null : parseXml(contentText);
  if (!content) return null;
  const stylesText = await archive.readText("styles.xml");
  const stylesRoot = stylesText === null ? null : parseXml(stylesText);
  const metaText = await archive.readText("meta.xml");
  return {
    content,
    styles: readStyles(stylesRoot ? [content, stylesRoot] : [content]),
    meta: metaText === null ? null : parseXml(metaText),
  };
}

function metaTitle(meta: Element | null): string | null {
  const title = meta ? textOf(descendantNamed(meta, "title")).trim() : "";
  return title === "" ? null : title;
}

/**
 * Reads an OpenDocument text (`.odt`) as a readable view (PAGE-385).
 *
 * @remarks
 * Macros and scripts (`Basic/`, `Scripts/`) and embedded objects are never
 * run; pictures that point outside the file are not loaded.
 *
 * @param archive - The opened package.
 * @returns The document, or `null` without `office:text`.
 */
export async function readOpenText(
  archive: ZipArchive,
): Promise<WordDocument | null> {
  const parts = await readParts(archive);
  const body = parts ? descendantNamed(parts.content, "text") : null;
  if (!parts || !body || body.parentElement?.localName !== "body") return null;
  const images = new PackageImages(archive);
  const context: OpenContext = {
    styles: parts.styles,
    images,
    blocks: [],
    pageBreaks: 0,
  };
  await readTextBody(body, context);
  const statistic = parts.meta
    ? descendantNamed(parts.meta, "document-statistic")
    : null;
  const pages = Number(attributeOf(statistic, "page-count") ?? "");
  return {
    kind: "word",
    title: metaTitle(parts.meta),
    blocks: context.blocks,
    pageCount:
      Number.isInteger(pages) && pages > 0 ? pages : context.pageBreaks + 1,
    images: images.images,
    isTruncated: context.blocks.length >= MAXIMUM_BLOCKS,
  };
}

/** Whether a frame lies inside another frame of the page, such as a picture in a text box. */
function isNestedFrame(frame: Element, page: Element): boolean {
  for (
    let parent = frame.parentElement;
    parent && parent !== page;
    parent = parent.parentElement
  )
    if (parent.localName === "frame") return true;
  return false;
}

async function readOpenSlide(
  page: Element,
  context: OpenContext,
): Promise<Omit<Slide, "number">> {
  let title = "";
  const blocks: DocumentBlock[] = [];
  for (const frame of descendantsNamed(page, "frame").filter(
    (candidate) => !isNestedFrame(candidate, page),
  )) {
    const slideContext: OpenContext = { ...context, blocks: [] };
    const box = childNamed(frame, "text-box");
    const table = childNamed(frame, "table");
    if (attributeOf(frame, "class") === "title" && box && title === "") {
      title = descendantsNamed(box, "p")
        .map((paragraph) => runsText(readSpans(paragraph, context, {})))
        .join(" ")
        .trim();
      continue;
    }
    if (box) await readTextBody(box, slideContext);
    else if (table) readTextTable(table, slideContext);
    else await readFrameList([frame], slideContext);
    blocks.push(...slideContext.blocks);
  }
  return { title: title || (attributeOf(page, "name") ?? ""), blocks };
}

/**
 * Reads an OpenDocument presentation (`.odp`) as slides (PAGE-385).
 *
 * @param archive - The opened package.
 * @returns The slides, or `null` without `office:presentation`.
 */
export async function readOpenSlides(
  archive: ZipArchive,
): Promise<SlidesDocument | null> {
  const parts = await readParts(archive);
  const body = parts ? descendantNamed(parts.content, "presentation") : null;
  if (!parts || !body) return null;
  const images = new PackageImages(archive);
  const context: OpenContext = {
    styles: parts.styles,
    images,
    blocks: [],
    pageBreaks: 0,
  };
  const pages = childrenNamed(body, "page");
  const slides: Slide[] = [];
  for (const page of pages.slice(0, MAXIMUM_SLIDES))
    slides.push({
      ...(await readOpenSlide(page, context)),
      number: slides.length + 1,
    });
  return {
    kind: "slides",
    title: metaTitle(parts.meta),
    slides,
    images: images.images,
    isTruncated: pages.length > MAXIMUM_SLIDES,
  };
}

/** The stored value of a spreadsheet cell: its shown text, and its number when it has one. */
function readOpenCell(cell: Element): SheetCell {
  const text = descendantsNamed(cell, "p")
    .map((paragraph) => textOf(paragraph))
    .join("\n");
  const type = attributeOf(cell, "value-type");
  const value = Number(attributeOf(cell, "value") ?? "");
  const number =
    type !== null && NUMERIC_TYPES.includes(type) && Number.isFinite(value)
      ? value
      : null;
  return {
    text: text === "" && number !== null ? String(value) : text,
    number,
  };
}

/** Non-trailing cells of one spreadsheet row. */
function readOpenSheetRow(row: Element): SheetCell[] {
  const cells: SheetCell[] = [];
  let pendingCells = 0;
  for (const cell of childrenNamed(row, "table-cell", "covered-table-cell")) {
    const repeat =
      Number(attributeOf(cell, "number-columns-repeated") ?? "1") || 1;
    const read = readOpenCell(cell);
    if (read.text === "") {
      pendingCells += repeat;
      continue;
    }
    const count = Math.min(pendingCells, MAXIMUM_SHEET_COLUMNS - cells.length);
    for (let index = 0; index < count; index += 1) cells.push(EMPTY_CELL);
    pendingCells = 0;
    for (
      let index = 0;
      index < Math.min(repeat, MAXIMUM_SHEET_COLUMNS - cells.length);
      index += 1
    )
      cells.push(read);
  }
  return cells;
}

/** The rows of a sheet; repeated empty rows and cells only count when something follows them. */
function readOpenSheetRows(table: Element): {
  rows: SheetCell[][];
  isCut: boolean;
} {
  const rows: SheetCell[][] = [];
  let pendingRows = 0;
  const containers = [
    table,
    ...childrenNamed(
      table,
      "table-header-rows",
      "table-rows",
      "table-row-group",
    ),
  ];
  for (const row of containers.flatMap((container) =>
    childrenNamed(container, "table-row"),
  )) {
    const cells = readOpenSheetRow(row);
    const repeat = Number(attributeOf(row, "number-rows-repeated") ?? "1") || 1;
    if (cells.length === 0) {
      pendingRows += repeat;
      continue;
    }
    for (
      let index = 0;
      index < pendingRows && rows.length <= MAXIMUM_SHEET_ROWS;
      index += 1
    )
      rows.push([]);
    pendingRows = 0;
    for (
      let index = 0;
      index < repeat && rows.length <= MAXIMUM_SHEET_ROWS;
      index += 1
    )
      rows.push(cells);
    if (rows.length > MAXIMUM_SHEET_ROWS) return { rows, isCut: true };
  }
  return { rows, isCut: false };
}

/**
 * Reads an OpenDocument spreadsheet (`.ods`) as tables (PAGE-385). Formulas
 * show the values the file stored; nothing is recalculated.
 *
 * @param archive - The opened package.
 * @returns The workbook, or `null` without `office:spreadsheet`.
 */
export async function readOpenSheets(
  archive: ZipArchive,
): Promise<SheetDocument | null> {
  const parts = await readParts(archive);
  const body = parts ? descendantNamed(parts.content, "spreadsheet") : null;
  if (!body) return null;
  const sheets: Sheet[] = childrenNamed(body, "table")
    .slice(0, MAXIMUM_SHEETS)
    .map((table, index) => {
      const { rows, isCut } = readOpenSheetRows(table);
      return sheetOf(
        attributeOf(table, "name") ?? String(index + 1),
        rows,
        isCut,
      );
    });
  return { kind: "sheet", sheets, delimiter: null };
}
