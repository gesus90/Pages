import { MAXIMUM_SLIDES, mergeRuns, runsText } from "./document-model";
import {
  PackageImages,
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
} from "./xml-nodes";

import type {
  DocumentBlock,
  DocumentRun,
  Slide,
  SlidesDocument,
} from "./document-model";
import type { OfficeRelation } from "./office-package";
import type { ZipArchive } from "./zip-entries";

const PRESENTATION_PART = "ppt/presentation.xml";
const TITLE_PLACEHOLDERS: readonly string[] = ["title", "ctrTitle"];

interface SlideContext {
  readonly relations: ReadonlyMap<string, OfficeRelation>;
  readonly images: PackageImages;
  readonly blocks: DocumentBlock[];
  title: string;
}

/** The emphasis of a DrawingML run from its `a:rPr`. */
function drawingStyle(
  run: Element,
  relations: ReadonlyMap<string, OfficeRelation>,
): Omit<DocumentRun, "text"> {
  const properties = childNamed(run, "rPr");
  const underline = attributeOf(properties, "u");
  const strike = attributeOf(properties, "strike");
  const link = relations.get(
    relationIdOf(properties ? childNamed(properties, "hlinkClick") : null) ??
      "",
  );
  return {
    ...(["1", "true"].includes(attributeOf(properties, "b") ?? "")
      ? { isBold: true }
      : {}),
    ...(["1", "true"].includes(attributeOf(properties, "i") ?? "")
      ? { isItalic: true }
      : {}),
    ...(underline !== null && underline !== "none"
      ? { isUnderline: true }
      : {}),
    ...(strike !== null && strike !== "noStrike" ? { isStrike: true } : {}),
    ...(link?.isExternal ? { link: link.target } : {}),
  };
}

/**
 * The runs of a DrawingML paragraph (`a:p`), as slides, shapes and charts of
 * Office files hold their text.
 *
 * @param paragraph - The `a:p` element.
 * @param relations - The relations of the part, for links.
 */
export function drawingRuns(
  paragraph: Element,
  relations: ReadonlyMap<string, OfficeRelation>,
): DocumentRun[] {
  const runs: DocumentRun[] = [];
  for (const child of paragraph.children) {
    if (child.localName === "br") runs.push({ text: "\n" });
    else if (child.localName === "r" || child.localName === "fld")
      runs.push({
        ...drawingStyle(child, relations),
        text: childNamed(child, "t")?.textContent ?? "",
      });
  }
  return mergeRuns(runs);
}

/** A paragraph of a text body as a list item or a paragraph. */
function drawingBlock(
  paragraph: Element,
  runs: DocumentRun[],
  isBody: boolean,
): DocumentBlock {
  const properties = childNamed(paragraph, "pPr");
  const level = Number(attributeOf(properties, "lvl") ?? "0");
  const isOrdered =
    properties !== null && childNamed(properties, "buAutoNum") !== null;
  const hasBullet =
    properties !== null && childNamed(properties, "buChar") !== null;
  const hasNone =
    properties !== null && childNamed(properties, "buNone") !== null;
  if (!hasNone && (isOrdered || hasBullet || isBody || level > 0))
    return {
      kind: "listItem",
      isOrdered,
      level: Number.isFinite(level) ? level : 0,
      runs,
    };
  return { kind: "paragraph", runs };
}

function readShape(shape: Element, context: SlideContext): void {
  const placeholder = descendantNamed(
    childNamed(shape, "nvSpPr") ?? shape,
    "ph",
  );
  const type = attributeOf(placeholder, "type");
  const body = childNamed(shape, "txBody");
  if (!body) return;
  const paragraphs = childrenNamed(body, "p").map((paragraph) => ({
    paragraph,
    runs: drawingRuns(paragraph, context.relations),
  }));
  if (TITLE_PLACEHOLDERS.includes(type ?? "") && context.title === "") {
    context.title = paragraphs
      .map(({ runs }) => runsText(runs))
      .join(" ")
      .trim();
    return;
  }
  // A body placeholder shows bullets unless a paragraph switches them off.
  const isBody = placeholder !== null && (type === null || type === "body");
  for (const { paragraph, runs } of paragraphs)
    if (runs.length > 0)
      context.blocks.push(drawingBlock(paragraph, runs, isBody));
}

/** A DrawingML table (`a:tbl`) as a table block. */
function readDrawingTable(table: Element, context: SlideContext): void {
  const rows = childrenNamed(table, "tr").map((row) =>
    childrenNamed(row, "tc").map((cell) => {
      const runs: DocumentRun[] = [];
      for (const paragraph of descendantsNamed(cell, "p")) {
        if (runs.length > 0) runs.push({ text: "\n" });
        runs.push(...drawingRuns(paragraph, context.relations));
      }
      return mergeRuns(runs);
    }),
  );
  if (rows.length > 0) context.blocks.push({ kind: "table", rows });
}

async function readPicture(
  picture: Element,
  context: SlideContext,
): Promise<void> {
  const blip = descendantNamed(picture, "blip");
  const description =
    attributeOf(descendantNamed(picture, "cNvPr"), "descr") ?? "";
  const imageId = await context.images.addRelation(
    context.relations.get(attributeOf(blip, "embed") ?? ""),
  );
  if (imageId !== null)
    context.blocks.push({ kind: "image", imageId, description });
}

async function readShapeTree(
  tree: Element,
  context: SlideContext,
): Promise<void> {
  for (const child of tree.children) {
    const name = child.localName;
    if (name === "sp") readShape(child, context);
    else if (name === "pic") await readPicture(child, context);
    else if (name === "grpSp") await readShapeTree(child, context);
    else if (name === "graphicFrame") {
      const table = descendantNamed(child, "tbl");
      if (table) readDrawingTable(table, context);
      else if (descendantNamed(child, "oleObj"))
        context.blocks.push({ kind: "embedded", description: "OLE" });
    }
  }
}

async function readSlide(
  archive: ZipArchive,
  path: string,
  images: PackageImages,
): Promise<Omit<Slide, "number"> | null> {
  const text = await archive.readText(path);
  const root = text === null ? null : parseXml(text);
  const tree = root ? descendantNamed(root, "spTree") : null;
  if (!tree) return null;
  const context: SlideContext = {
    relations: await readRelations(archive, path),
    images,
    blocks: [],
    title: "",
  };
  await readShapeTree(tree, context);
  return { title: context.title, blocks: context.blocks };
}

/** The slide parts in the order of the presentation. */
async function slidePaths(archive: ZipArchive): Promise<string[]> {
  const text = await archive.readText(PRESENTATION_PART);
  const root = text === null ? null : parseXml(text);
  if (!root) return [];
  const relations = await readRelations(archive, PRESENTATION_PART);
  const list = descendantNamed(root, "sldIdLst");
  return (list ? childrenNamed(list, "sldId") : [])
    .map((slide) => relations.get(relationIdOf(slide) ?? ""))
    .filter(
      (relation): relation is OfficeRelation =>
        relation !== undefined && !relation.isExternal,
    )
    .map((relation) => relation.target);
}

/**
 * Reads a PowerPoint presentation (`.pptx`) as slides (PAGE-385): title,
 * text, tables and the images inside the file of every slide.
 *
 * @remarks
 * Macros, embedded objects and media are never run; links and images that
 * point outside the file are not loaded. Layout, themes and animations are
 * left out on purpose.
 *
 * @param archive - The opened package.
 * @returns The slides, or `null` without `ppt/presentation.xml`.
 */
export async function readSlidesDocument(
  archive: ZipArchive,
): Promise<SlidesDocument | null> {
  if (!archive.has(PRESENTATION_PART)) return null;
  const paths = await slidePaths(archive);
  const images = new PackageImages(archive);
  const slides: Slide[] = [];
  for (const path of paths.slice(0, MAXIMUM_SLIDES)) {
    const slide = await readSlide(archive, path, images);
    if (slide) slides.push({ ...slide, number: slides.length + 1 });
  }
  return {
    kind: "slides",
    title: await readOfficeTitle(archive),
    slides,
    images: images.images,
    isTruncated: paths.length > MAXIMUM_SLIDES,
  };
}
