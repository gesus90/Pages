/**
 * The readable view of documents, slides and tables: plain data
 * the chat renders as text with its own components, never as markup of the
 * file.
 */

/** A piece of text with one emphasis. */
export interface DocumentRun {
  readonly text: string;
  readonly isBold?: boolean;
  readonly isItalic?: boolean;
  readonly isUnderline?: boolean;
  readonly isStrike?: boolean;
  /** The target of a link of the file; shown, never loaded by itself. */
  readonly link?: string;
}

/** One block of a document or a slide. */
export type DocumentBlock =
  | {
      readonly kind: "heading";
      readonly level: number;
      readonly runs: readonly DocumentRun[];
    }
  | { readonly kind: "paragraph"; readonly runs: readonly DocumentRun[] }
  | {
      readonly kind: "listItem";
      readonly isOrdered: boolean;
      /** The depth of the item, from 0. */
      readonly level: number;
      readonly runs: readonly DocumentRun[];
    }
  | {
      readonly kind: "table";
      /** Rows of cells; a cell holds the runs of its paragraphs, separated by line breaks. */
      readonly rows: readonly (readonly (readonly DocumentRun[])[])[];
    }
  | {
      readonly kind: "image";
      readonly imageId: string;
      readonly description: string;
    }
  | {
      /** An embedded object or program of the file; named, never executed. */
      readonly kind: "embedded";
      readonly description: string;
    }
  | { readonly kind: "pageBreak" };

/** A Word or OpenDocument text, as a readable view. */
export interface WordDocument {
  readonly kind: "word";
  readonly title: string | null;
  readonly blocks: readonly DocumentBlock[];
  /** The page count the file names, or one more than its page breaks. */
  readonly pageCount: number;
  /** Embedded images by their ID. */
  readonly images: ReadonlyMap<string, Blob>;
  /** Only the start of a very long document was read. */
  readonly isTruncated: boolean;
}

/** One slide: its title and its content. */
export interface Slide {
  /** Counted from 1. */
  readonly number: number;
  readonly title: string;
  readonly blocks: readonly DocumentBlock[];
}

/** A PowerPoint or OpenDocument presentation, as one card per slide. */
export interface SlidesDocument {
  readonly kind: "slides";
  readonly title: string | null;
  readonly slides: readonly Slide[];
  readonly images: ReadonlyMap<string, Blob>;
  readonly isTruncated: boolean;
}

/** One cell of a table: the value as the file stores it. */
export interface SheetCell {
  readonly text: string;
  /** The number of a numeric cell, for right alignment, sorting and sums; else `null`. */
  readonly number: number | null;
}

/** One sheet of a workbook, or the table of a CSV file. */
export interface Sheet {
  readonly name: string;
  /** Every row read, the first one included, each as long as `columnCount`. */
  readonly rows: readonly (readonly SheetCell[])[];
  readonly columnCount: number;
  /** The sheet holds more rows or columns than were read. */
  readonly isTruncated: boolean;
}

/** A workbook or a CSV/TSV file, as tables with one tab per sheet. */
export interface SheetDocument {
  readonly kind: "sheet";
  readonly sheets: readonly Sheet[];
  /** The delimiter of a CSV or TSV file; `null` for a workbook. */
  readonly delimiter: string | null;
}

/** Any document the chat reads. */
export type ReadDocument = WordDocument | SlidesDocument | SheetDocument;

/** Most blocks of a document or slides read. */
export const MAXIMUM_BLOCKS = 20_000;
/** Most slides read. */
export const MAXIMUM_SLIDES = 500;
/** Most rows and columns of a sheet read. */
export const MAXIMUM_SHEET_ROWS = 50_000;
export const MAXIMUM_SHEET_COLUMNS = 200;
/** Most sheets of a workbook read. */
export const MAXIMUM_SHEETS = 100;

/** The plain text of runs. */
export function runsText(runs: readonly DocumentRun[]): string {
  return runs.map((run) => run.text).join("");
}

/** The plain text of a block, for the search and the table of contents. */
export function blockText(block: DocumentBlock): string {
  switch (block.kind) {
    case "heading":
    case "paragraph":
    case "listItem":
      return runsText(block.runs);
    case "table":
      return block.rows.map((row) => row.map(runsText).join("\t")).join("\n");
    case "image":
    case "embedded":
      return block.description;
    case "pageBreak":
      return "";
  }
}

/** Joins neighbouring runs of the same emphasis and drops empty ones. */
export function mergeRuns(runs: readonly DocumentRun[]): DocumentRun[] {
  const merged: DocumentRun[] = [];
  for (const run of runs) {
    if (run.text === "") continue;
    const previous = merged.at(-1);
    if (
      previous &&
      previous.isBold === run.isBold &&
      previous.isItalic === run.isItalic &&
      previous.isUnderline === run.isUnderline &&
      previous.isStrike === run.isStrike &&
      previous.link === run.link
    )
      merged[merged.length - 1] = {
        ...previous,
        text: previous.text + run.text,
      };
    else merged.push(run);
  }
  return merged;
}

/** The image types a browser shows in an image element; others are left out. */
const IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

/**
 * The image type of an embedded file by its ending.
 * @param path - The path of the file in the package.
 * @returns The type, or `null` for a format the browser cannot show, such as EMF.
 */
export function imageTypeOf(path: string): string | null {
  const ending = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return IMAGE_TYPES[ending] ?? null;
}
