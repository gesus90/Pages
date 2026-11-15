import { describe, expect, it } from "vitest";

import {
  documentFormatOf,
  fileViewOf,
} from "@/app/components/chat-page/content/documents/document-kinds";
import { blockText } from "@/app/components/chat-page/content/documents/document-model";
import {
  DocumentReadError,
  readDocument,
} from "@/app/components/chat-page/content/documents/read-document";
import {
  columnIndex,
  columnLetters,
  numberOfText,
} from "@/app/components/chat-page/content/documents/sheet-reader";
import { isCompoundFile } from "@/app/components/chat-page/content/documents/zip-entries";

import {
  docxFixture,
  odpFixture,
  odsFixture,
  odtFixture,
  pptxFixture,
  xlsxFixture,
  zipOf,
} from "./zip-fixture";

import type {
  SheetDocument,
  SlidesDocument,
  WordDocument,
} from "@/app/components/chat-page/content/documents/document-model";

const MB = 1024 * 1024;

async function read<T>(
  bytes: Uint8Array,
  format: Parameters<typeof readDocument>[1]["format"],
  name = "datei",
): Promise<T> {
  // The readers return the document of their format; the test names which one it expects.
  return (await readDocument(bytes, { format, name })) as T;
}

describe("how the chat shows a file (PAGE-385)", () => {
  it("knows the document formats by ending or type and offers everything else for download", () => {
    expect(
      documentFormatOf({
        name: "Bericht.DOCX",
        mimeType: "application/octet-stream",
      }),
    ).toBe("docx");
    expect(
      documentFormatOf({ name: "export", mimeType: "text/csv; charset=utf-8" }),
    ).toBe("csv");
    const file = {
      kind: "file" as const,
      mimeType: "application/octet-stream",
      sizeBytes: 1000,
    };
    expect(fileViewOf({ ...file, name: "a.odp" })).toEqual({
      kind: "document",
      format: "odp",
      view: "slides",
    });
    expect(fileViewOf({ ...file, name: "a.tsv" })).toEqual({
      kind: "document",
      format: "tsv",
      view: "sheet",
    });
    for (const name of [
      "backup.zip",
      "logs.tar.gz",
      "setup.exe",
      "daten.sqlite",
      "firmware.bin",
      "alt.doc",
      "alt.xls",
      "alt.ppt",
    ])
      expect(fileViewOf({ ...file, name })).toEqual({
        kind: "binary",
        isTooLarge: false,
      });
  });

  it("offers documents above the preview limit of 32 MB for download only", () => {
    expect(
      fileViewOf({
        kind: "file",
        name: "gross.xlsx",
        mimeType: "",
        sizeBytes: 33 * MB,
      }),
    ).toEqual({ kind: "binary", isTooLarge: true });
    expect(
      fileViewOf({
        kind: "pdf",
        name: "gross.pdf",
        mimeType: "application/pdf",
        sizeBytes: 40 * MB,
      }),
    ).toEqual({ kind: "binary", isTooLarge: true });
    expect(
      fileViewOf({
        kind: "pdf",
        name: "klein.pdf",
        mimeType: "application/pdf",
        sizeBytes: MB,
      }),
    ).toEqual({ kind: "pdf" });
  });
});

describe("Word and OpenDocument text as a readable view (PAGE-385)", () => {
  it("reads headings, emphasis, lists, tables, images, links and the page count of a .docx", async () => {
    const document = await read<WordDocument>(docxFixture(), "docx");
    expect(document.title).toBe("Bericht Q3");
    expect(document.pageCount).toBe(3);
    const [heading, paragraph, bullet, step, table, image] = document.blocks;
    expect(heading).toEqual({
      kind: "heading",
      level: 1,
      runs: [{ text: "Quartalsbericht" }],
    });
    expect(paragraph).toEqual({
      kind: "paragraph",
      runs: [
        { text: "Der Umsatz ist " },
        { text: "deutlich", isBold: true },
        { text: " gestiegen", isItalic: true },
        { text: "." },
      ],
    });
    expect(bullet).toMatchObject({
      kind: "listItem",
      isOrdered: false,
      level: 0,
    });
    expect(step).toMatchObject({ kind: "listItem", isOrdered: true });
    expect(
      table?.kind === "table" &&
        table.rows.map((row) => row.map((cell) => cell[0]?.text)),
    ).toEqual([
      ["Region", "Umsatz"],
      ["Nord", "1200"],
    ]);
    expect(image).toEqual({
      kind: "image",
      imageId: "word/media/image1.png",
      description: "Diagramm",
    });
    expect(document.images.get("word/media/image1.png")?.type).toBe(
      "image/png",
    );
    expect(document.blocks).toContainEqual({
      kind: "paragraph",
      runs: [{ text: "Webseite", link: "https://pages.example/" }],
    });
    expect(document.blocks).toContainEqual({ kind: "pageBreak" });
    expect(document.blocks).toContainEqual({
      kind: "heading",
      level: 2,
      runs: [{ text: "Ausblick" }],
    });
  });

  it("never loads pictures outside the file and only names macros and embedded objects", async () => {
    const document = await read<WordDocument>(docxFixture(), "docx");
    expect([...document.images.keys()]).toEqual(["word/media/image1.png"]);
    expect(document.blocks).toContainEqual({
      kind: "embedded",
      description: "OLE",
    });
    expect(document.blocks.map(blockText).join(" ")).not.toMatch(
      /AutoOpen|calc|ignored/u,
    );
  });
});

describe("OpenDocument text and invalid document errors (PAGE-385)", () => {
  it("reads an .odt with heading, emphasis, ordered list, table, image and page count", async () => {
    const document = await read<WordDocument>(odtFixture(), "odt");
    expect(document.title).toBe("Sitzung");
    expect(document.pageCount).toBe(2);
    expect(document.blocks[0]).toEqual({
      kind: "heading",
      level: 1,
      runs: [{ text: "Protokoll" }],
    });
    expect(document.blocks[1]).toEqual({
      kind: "paragraph",
      runs: [
        { text: "Es gilt " },
        { text: "ab sofort", isBold: true },
        { text: ".  Ende" },
      ],
    });
    expect(document.blocks[2]).toMatchObject({
      kind: "listItem",
      isOrdered: true,
      runs: [{ text: "Punkt A" }],
    });
    expect(
      document.blocks.find((block) => block.kind === "table"),
    ).toBeDefined();
    expect([...document.images.keys()]).toEqual(["Pictures/a.png"]);
    expect(document.blocks).toContainEqual({
      kind: "embedded",
      description: "Objekt",
    });
  });

  it("names encrypted and damaged files instead of showing them", async () => {
    const compound = new Uint8Array([
      0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
    ]);
    expect(isCompoundFile(compound)).toBe(true);
    await expect(
      readDocument(compound, { format: "docx", name: "x" }),
    ).rejects.toEqual(new DocumentReadError("encrypted"));
    await expect(
      readDocument(
        zipOf([["word/document.xml", "<x/>"]], { isEncrypted: true }),
        { format: "docx", name: "x" },
      ),
    ).rejects.toMatchObject({
      reason: "encrypted",
    });
    await expect(
      readDocument(new Uint8Array([1, 2, 3]), { format: "xlsx", name: "x" }),
    ).rejects.toMatchObject({ reason: "unreadable" });
    await expect(
      readDocument(zipOf([["other.xml", "<x/>"]]), {
        format: "pptx",
        name: "x",
      }),
    ).rejects.toMatchObject({ reason: "unreadable" });
  });
});

describe("PowerPoint and OpenDocument presentations as slides (PAGE-385)", () => {
  it("reads every slide of a .pptx with title, text and pictures in order", async () => {
    const document = await read<SlidesDocument>(pptxFixture(), "pptx");
    expect(document.slides.map((slide) => slide.title)).toEqual([
      "Willkommen",
      "Zahlen",
    ]);
    expect(document.slides[0]?.blocks).toEqual([
      {
        kind: "listItem",
        isOrdered: false,
        level: 0,
        runs: [{ text: "Agenda", isBold: true }],
      },
    ]);
    expect(document.slides[1]?.blocks).toContainEqual({
      kind: "image",
      imageId: "ppt/media/image1.png",
      description: "Logo",
    });
  });

  it("reads the pages of an .odp", async () => {
    const document = await read<SlidesDocument>(odpFixture(), "odp");
    expect(document.slides).toHaveLength(2);
    expect(document.slides[0]).toMatchObject({ number: 1, title: "Start" });
    expect(document.slides[0]?.blocks).toEqual([
      {
        kind: "listItem",
        isOrdered: false,
        level: 0,
        runs: [{ text: "Ziel" }],
      },
    ]);
    expect(document.slides[1]).toMatchObject({
      title: "Seite 2",
      blocks: [{ kind: "image", imageId: "Pictures/a.png" }],
    });
  });
});

describe("workbooks and CSV as tables (PAGE-385)", () => {
  it("reads the visible sheets of an .xlsx with the stored values of formulas", async () => {
    const document = await read<SheetDocument>(xlsxFixture(), "xlsx");
    expect(document.sheets.map((sheet) => sheet.name)).toEqual([
      "Umsatz",
      "Kosten",
    ]);
    const [sheet] = document.sheets;
    expect(sheet?.columnCount).toBe(4);
    expect(sheet?.rows.map((row) => row.map((cell) => cell.text))).toEqual([
      ["Region", "Umsatz", "Datum", "Anteil"],
      ["Nord", "1200.5", "2024-11-15", "25 %"],
      ["", "", "", ""],
      ["Summe", "1200.5", "", ""],
    ]);
    expect(sheet?.rows[1]?.[1]?.number).toBe(1200.5);
    expect(sheet?.rows[1]?.[2]?.number).toBeNull();
    expect(document.sheets[1]?.rows).toEqual([
      [
        { text: "", number: null },
        { text: "7", number: 7 },
      ],
    ]);
  });

  it("reads an .ods without expanding a million empty rows", async () => {
    const document = await read<SheetDocument>(odsFixture(), "ods");
    const [sheet] = document.sheets;
    expect(sheet?.rows.map((row) => row.map((cell) => cell.text))).toEqual([
      ["Artikel", "Preis"],
      ["Tee", "3,50"],
    ]);
    expect(sheet?.rows[1]?.[1]?.number).toBe(3.5);
    expect(document.sheets[1]).toMatchObject({
      name: "Leer",
      rows: [],
      columnCount: 0,
    });
  });

  it("recognizes the delimiter of CSV and reads TSV by its tab", async () => {
    const semicolon = await read<SheetDocument>(
      new TextEncoder().encode('Name;Betrag\nA;1,5\n"B;C";2\n'),
      "csv",
      "a.csv",
    );
    expect(semicolon.delimiter).toBe(";");
    expect(
      semicolon.sheets[0]?.rows.map((row) => row.map((cell) => cell.text)),
    ).toEqual([
      ["Name", "Betrag"],
      ["A", "1,5"],
      ["B;C", "2"],
    ]);
    expect(semicolon.sheets[0]?.rows[1]?.[1]?.number).toBe(1.5);
    const tab = await read<SheetDocument>(
      new TextEncoder().encode("x\ty,z\n1\t2\n"),
      "tsv",
      "b.tsv",
    );
    expect(tab.delimiter).toBe("\t");
    expect(tab.sheets[0]?.rows[0]?.map((cell) => cell.text)).toEqual([
      "x",
      "y,z",
    ]);
    const latin = await read<SheetDocument>(
      new Uint8Array([
        0x4b, 0xe4, 0x73, 0x65, 0x2c, 0x31, 0x0a, 0x42, 0x2c, 0x32,
      ]),
      "csv",
    );
    expect(latin.sheets[0]?.rows[0]?.[0]?.text).toBe("Käse");
  });

  it("names columns by letters and reads numbers with dot or comma", () => {
    expect([0, 25, 26, 27, 701].map(columnLetters)).toEqual([
      "A",
      "Z",
      "AA",
      "AB",
      "ZZ",
    ]);
    expect(columnIndex("AB")).toBe(27);
    expect(numberOfText(" 1,25 ")).toBe(1.25);
    expect(numberOfText("12 Stück")).toBeNull();
  });
});
