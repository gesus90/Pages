import { MAXIMUM_BLOCKS, mergeRuns } from "./document-model";
import {
  PackageImages,
  isSwitchedOn,
  readOfficeTitle,
  readRelations,
} from "./office-package";
import {
  attributeOf,
  childNamed,
  childrenNamed,
  descendantNamed,
  descendantsNamed,
  parseXml,
  relationIdOf,
  textOf,
} from "./xml-nodes";

import type {
  DocumentBlock,
  DocumentRun,
  WordDocument,
} from "./document-model";
import type { OfficeRelation } from "./office-package";
import type { ZipArchive } from "./zip-entries";

const DOCUMENT_PART = "word/document.xml";
const HEADING_NAME = /^(?:heading|überschrift|titre|título)\s*(\d)$/iu;

/** What the reading of one document knows besides the current paragraph. */
interface WordContext {
  readonly headingLevels: ReadonlyMap<string, number>;
  /** Whether list `numId` at level `ilvl` counts, by `numId:ilvl`. */
  readonly orderedLevels: ReadonlyMap<string, boolean>;
  readonly relations: ReadonlyMap<string, OfficeRelation>;
  readonly images: PackageImages;
  readonly blocks: DocumentBlock[];
  pageBreaks: number;
}

/** The emphasis of a run from its properties. */
function runStyle(
  run: Element,
  link: string | undefined,
): Omit<DocumentRun, "text"> {
  const properties = childNamed(run, "rPr");
  const underline = properties ? childNamed(properties, "u") : null;
  return {
    ...(properties && isSwitchedOn(childNamed(properties, "b"))
      ? { isBold: true }
      : {}),
    ...(properties && isSwitchedOn(childNamed(properties, "i"))
      ? { isItalic: true }
      : {}),
    ...(underline && attributeOf(underline, "val") !== "none"
      ? { isUnderline: true }
      : {}),
    ...(properties &&
    (isSwitchedOn(childNamed(properties, "strike")) ||
      isSwitchedOn(childNamed(properties, "dstrike")))
      ? { isStrike: true }
      : {}),
    ...(link === undefined ? {} : { link }),
  };
}

/** Heading levels by paragraph style ID, from the names and outline levels of `styles.xml`. */
async function readHeadingLevels(
  archive: ZipArchive,
): Promise<Map<string, number>> {
  const levels = new Map<string, number>();
  const text = await archive.readText("word/styles.xml");
  const root = text === null ? null : parseXml(text);
  if (!root) return levels;
  for (const style of childrenNamed(root, "style")) {
    const id = attributeOf(style, "styleId");
    if (id === null || attributeOf(style, "type") !== "paragraph") continue;
    const name = attributeOf(childNamed(style, "name"), "val") ?? "";
    const outline = attributeOf(descendantNamed(style, "outlineLvl"), "val");
    const match = HEADING_NAME.exec(name);
    if (name.toLowerCase() === "title") levels.set(id, 1);
    else if (match) levels.set(id, Number(match[1]));
    else if (outline !== null && Number(outline) < 6)
      levels.set(id, Number(outline) + 1);
  }
  return levels;
}

/** Which list levels count instead of using bullets, from `numbering.xml`. */
async function readOrderedLevels(
  archive: ZipArchive,
): Promise<Map<string, boolean>> {
  const ordered = new Map<string, boolean>();
  const text = await archive.readText("word/numbering.xml");
  const root = text === null ? null : parseXml(text);
  if (!root) return ordered;
  const abstract = new Map<string, Element>();
  for (const definition of childrenNamed(root, "abstractNum"))
    abstract.set(attributeOf(definition, "abstractNumId") ?? "", definition);
  for (const numbering of childrenNamed(root, "num")) {
    const id = attributeOf(numbering, "numId");
    const definition = abstract.get(
      attributeOf(childNamed(numbering, "abstractNumId"), "val") ?? "",
    );
    if (id === null || !definition) continue;
    for (const level of childrenNamed(definition, "lvl")) {
      const format =
        attributeOf(childNamed(level, "numFmt"), "val") ?? "bullet";
      ordered.set(
        `${id}:${attributeOf(level, "ilvl") ?? "0"}`,
        !["bullet", "none"].includes(format),
      );
    }
  }
  return ordered;
}

/** The page count `docProps/app.xml` names, or `null`. */
async function readPageCount(archive: ZipArchive): Promise<number | null> {
  const text = await archive.readText("docProps/app.xml");
  const root = text === null ? null : parseXml(text);
  const pages = root
    ? Number(textOf(descendantNamed(root, "Pages")))
    : Number.NaN;
  return Number.isInteger(pages) && pages > 0 ? pages : null;
}

/** Reads the images of a drawing or an old VML picture inside the package. */
async function readDrawing(
  element: Element,
  context: WordContext,
): Promise<void> {
  const blips = [
    ...descendantsNamed(element, "blip"),
    ...descendantsNamed(element, "imagedata"),
  ];
  const description =
    attributeOf(descendantNamed(element, "docPr"), "descr") ??
    attributeOf(descendantNamed(element, "docPr"), "name") ??
    "";
  for (const blip of blips) {
    // `r:embed` lies inside the file; `r:link` points outside and is never loaded.
    const id = attributeOf(blip, "embed") ?? relationIdOf(blip);
    const imageId =
      id === null
        ? null
        : await context.images.addRelation(context.relations.get(id));
    if (imageId !== null)
      context.blocks.push({ kind: "image", imageId, description });
  }
}

/** The runs of one run element; drawings become their own blocks. */
async function readRun(
  run: Element,
  context: WordContext,
  link: string | undefined,
): Promise<DocumentRun[]> {
  const style = runStyle(run, link);
  const runs: DocumentRun[] = [];
  for (const child of run.children) {
    const name = child.localName;
    if (name === "t") runs.push({ ...style, text: child.textContent ?? "" });
    else if (name === "tab") runs.push({ ...style, text: "\t" });
    else if (name === "br" && attributeOf(child, "type") === "page")
      context.pageBreaks += 1;
    else if (name === "br" || name === "cr")
      runs.push({ ...style, text: "\n" });
    else if (name === "drawing" || name === "pict")
      await readDrawing(child, context);
    else if (name === "object")
      context.blocks.push({ kind: "embedded", description: "OLE" });
  }
  return runs;
}

/** The runs of a paragraph, through links, insertions, fields and smart tags. */
async function readInline(
  parent: Element,
  context: WordContext,
  link?: string,
): Promise<DocumentRun[]> {
  const runs: DocumentRun[] = [];
  for (const child of parent.children) {
    const name = child.localName;
    if (name === "r") runs.push(...(await readRun(child, context, link)));
    else if (name === "hyperlink") {
      const relation = context.relations.get(relationIdOf(child) ?? "");
      const target = relation?.isExternal ? relation.target : link;
      runs.push(...(await readInline(child, context, target)));
    } else if (
      [
        "ins",
        "smartTag",
        "fldSimple",
        "sdt",
        "sdtContent",
        "customXml",
      ].includes(name)
    )
      runs.push(...(await readInline(child, context, link)));
  }
  return runs;
}

/** Turns a paragraph into a heading, a list item or a paragraph. */
function paragraphBlock(
  paragraph: Element,
  runs: DocumentRun[],
  context: WordContext,
): DocumentBlock | null {
  const properties = childNamed(paragraph, "pPr");
  const styleId =
    attributeOf(properties ? childNamed(properties, "pStyle") : null, "val") ??
    "";
  const merged = mergeRuns(runs);
  const level = context.headingLevels.get(styleId);
  const numbering = properties ? childNamed(properties, "numPr") : null;
  const numId = attributeOf(
    numbering ? childNamed(numbering, "numId") : null,
    "val",
  );
  if (merged.length === 0) return null;
  if (level !== undefined)
    return { kind: "heading", level: Math.min(level, 6), runs: merged };
  if (numbering && numId !== null && numId !== "0") {
    const listLevel = Number(
      attributeOf(childNamed(numbering, "ilvl"), "val") ?? "0",
    );
    return {
      kind: "listItem",
      isOrdered:
        context.orderedLevels.get(`${numId}:${String(listLevel)}`) ?? false,
      level: Number.isFinite(listLevel) ? listLevel : 0,
      runs: merged,
    };
  }
  return { kind: "paragraph", runs: merged };
}

async function readParagraph(
  paragraph: Element,
  context: WordContext,
): Promise<void> {
  const breaksBefore = context.pageBreaks;
  const imageIndex = context.blocks.length;
  const runs = await readInline(paragraph, context);
  const block = paragraphBlock(paragraph, runs, context);
  // Images of the paragraph were added while it was read; its text stands before them.
  if (block) context.blocks.splice(imageIndex, 0, block);
  for (let index = breaksBefore; index < context.pageBreaks; index += 1)
    context.blocks.push({ kind: "pageBreak" });
}

async function readTableCell(
  cell: Element,
  context: WordContext,
): Promise<DocumentRun[]> {
  const runs: DocumentRun[] = [];
  for (const paragraph of descendantsNamed(cell, "p")) {
    if (runs.length > 0) runs.push({ text: "\n" });
    runs.push(...(await readInline(paragraph, { ...context, blocks: [] })));
  }
  return mergeRuns(runs);
}

/** The cell text of a table: its paragraphs joined by line breaks, nested tables as text. */
async function readTable(table: Element, context: WordContext): Promise<void> {
  const rows: DocumentRun[][][] = [];
  for (const row of childrenNamed(table, "tr")) {
    const cells: DocumentRun[][] = [];
    for (const cell of childrenNamed(row, "tc")) {
      cells.push(await readTableCell(cell, context));
    }
    rows.push(cells);
  }
  if (rows.length > 0) context.blocks.push({ kind: "table", rows });
}

async function readBody(body: Element, context: WordContext): Promise<void> {
  for (const child of body.children) {
    if (context.blocks.length >= MAXIMUM_BLOCKS) return;
    const name = child.localName;
    if (name === "p") await readParagraph(child, context);
    else if (name === "tbl") await readTable(child, context);
    else if (name === "sdt" || name === "sdtContent" || name === "customXml")
      await readBody(child, context);
  }
}

/**
 * Reads a Word document (`.docx`) as a readable view: headings,
 * paragraphs, lists, tables, emphasis and the images inside the file.
 *
 * @remarks
 * Macros (`vbaProject.bin`) and embedded objects are never run; an embedded
 * object is only named. Images and links that point outside the file are not
 * loaded. Page layout, fonts and colors of the file are left out on purpose.
 *
 * @param archive - The opened package.
 * @returns The document, or `null` when it holds no `word/document.xml`.
 */
export async function readWordDocument(
  archive: ZipArchive,
): Promise<WordDocument | null> {
  const text = await archive.readText(DOCUMENT_PART);
  const root = text === null ? null : parseXml(text);
  const body = root ? descendantNamed(root, "body") : null;
  if (!body) return null;
  const images = new PackageImages(archive);
  const context: WordContext = {
    headingLevels: await readHeadingLevels(archive),
    orderedLevels: await readOrderedLevels(archive),
    relations: await readRelations(archive, DOCUMENT_PART),
    images,
    blocks: [],
    pageBreaks: 0,
  };
  await readBody(body, context);
  const renderedBreaks = descendantsNamed(body, "lastRenderedPageBreak").length;
  const pageCount =
    (await readPageCount(archive)) ??
    Math.max(context.pageBreaks, renderedBreaks) + 1;
  return {
    kind: "word",
    title: await readOfficeTitle(archive),
    blocks: context.blocks,
    pageCount,
    images: images.images,
    isTruncated: context.blocks.length >= MAXIMUM_BLOCKS,
  };
}
