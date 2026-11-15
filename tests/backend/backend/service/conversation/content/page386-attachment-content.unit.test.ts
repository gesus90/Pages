import { Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  AGENT_NO_IMAGE_SIGHT,
  ConversationAttachmentContent,
} from "@/backend/service/conversation/content/ConversationAttachmentContent";
import { agentAttachmentKind } from "@/backend/service/conversation/content/ConversationAttachmentKinds";

import type { Mock } from "vitest";

import type { ConversationTranscriber } from "@/backend/service/conversation/ConversationTranscriber";
import type { AgentAttachmentSource } from "@/backend/service/conversation/content/ConversationAttachmentContent";
import type { ConversationVideoFrameReader } from "@/backend/service/conversation/content/ConversationVideoFrames";

import {
  buildZip,
  sheetXml,
  workbookParts,
} from "../../chat/office-zip-fixture";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);

function source(
  name: string,
  mimeType: string,
  bytes: Buffer,
  extra: Omit<Partial<AgentAttachmentSource>, "open"> = {},
): AgentAttachmentSource & { readonly open: ReturnType<typeof vi.fn> } {
  const open = vi.fn(() => Readable.from([bytes]));
  return {
    name,
    mimeType,
    sizeBytes: bytes.length,
    kind: agentAttachmentKind(name, mimeType),
    preview: null,
    durationSeconds: null,
    knownText: null,
    ...extra,
    open,
  };
}

function reader(
  overrides: {
    transcribe?: Mock<ConversationTranscriber["transcribe"]>;
    frames?: ConversationVideoFrameReader;
    pdfImages?: (bytes: Buffer, page: number) => Promise<Buffer[]>;
  } = {},
): {
  content: ConversationAttachmentContent;
  transcribe: Mock<ConversationTranscriber["transcribe"]>;
} {
  const transcribe =
    overrides.transcribe ??
    vi.fn<ConversationTranscriber["transcribe"]>().mockResolvedValue({
      ok: true,
      text: "Hallo zusammen, das Deployment ist kaputt.",
    });
  return {
    transcribe,
    content: new ConversationAttachmentContent({
      transcriber: { transcribe },
      ...(overrides.frames ? { frames: overrides.frames } : {}),
      ...(overrides.pdfImages ? { pdfImages: overrides.pdfImages } : {}),
    }),
  };
}

const WORD_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function wordFile(
  body: string,
  extras: { name: string; content: string | Buffer }[] = [],
): Buffer {
  return buildZip([
    {
      name: "word/document.xml",
      content: `<w:document><w:body>${body}</w:body></w:document>`,
    },
    ...extras,
  ]);
}

describe("PAGE-386 images", () => {
  it("hands a screenshot to a model that sees images", async () => {
    const { content } = reader();
    const reading = await content.read(
      source("screenshot.png", "image/png", PNG),
      {},
      true,
    );
    expect(reading.images).toEqual([
      { label: "screenshot.png", mimeType: "image/png", data: PNG },
    ]);
    expect(reading.result).toEqual({ bildSichtbar: true });
  });

  it("tells a model without sight that it cannot see the image and never opens it", async () => {
    const { content } = reader();
    const file = source("screenshot.png", "image/png", PNG);
    const reading = await content.read(file, {}, false);
    expect(reading.images).toEqual([]);
    expect(reading.result).toEqual({
      hinweis: AGENT_NO_IMAGE_SIGHT,
      bildSichtbar: false,
    });
    expect(file.open).not.toHaveBeenCalled();
  });
});

describe("PAGE-386 documents by page and slide", () => {
  it("splits a Word document at its page breaks and numbers the pages", async () => {
    const { content } = reader();
    const bytes = wordFile(
      '<w:p><w:r><w:t>Einleitung</w:t></w:r></w:p><w:p><w:r><w:br w:type="page"/><w:t>Der Fehler steht hier.</w:t></w:r></w:p>',
    );
    const reading = await content.read(
      source("Bericht.docx", WORD_TYPE, bytes),
      {},
      true,
    );
    expect(reading.result).toMatchObject({
      seiten: 2,
      abschnitte: [
        { ort: "Seite 1", text: "Einleitung" },
        { ort: "Seite 2", text: "Der Fehler steht hier." },
      ],
    });
    expect(reading.searchText).toContain("Der Fehler steht hier.");
  });

  it("reads only the asked pages", async () => {
    const { content } = reader();
    const bytes = wordFile(
      '<w:p><w:r><w:t>Eins</w:t></w:r></w:p><w:p><w:r><w:br w:type="page"/><w:t>Zwei</w:t></w:r></w:p><w:p><w:r><w:br w:type="page"/><w:t>Drei</w:t></w:r></w:p>',
    );
    const reading = await content.read(
      source("a.docx", WORD_TYPE, bytes),
      { from: 2, to: 2 },
      true,
    );
    expect(reading.result).toMatchObject({
      seiten: 3,
      abschnitte: [{ ort: "Seite 2", text: "Zwei" }],
    });
  });

  it("numbers the slides of a PowerPoint file", async () => {
    const { content } = reader();
    const bytes = buildZip([
      {
        name: "ppt/slides/slide1.xml",
        content: "<p:sld><a:p><a:t>Titel</a:t></a:p></p:sld>",
      },
      {
        name: "ppt/slides/slide2.xml",
        content: "<p:sld><a:p><a:t>Umsatz 2026: 4,2 Mio</a:t></a:p></p:sld>",
      },
    ]);
    const reading = await content.read(
      source(
        "Q3.pptx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        bytes,
      ),
      {},
      true,
    );
    expect(reading.result).toMatchObject({
      folien: 2,
      abschnitte: [
        { ort: "Folie 1", text: "Titel" },
        { ort: "Folie 2", text: "Umsatz 2026: 4,2 Mio" },
      ],
    });
  });
});

describe("PAGE-386 OpenDocument pages, slides and redaction", () => {
  it("reads OpenDocument text with its page breaks and presentations by slide", async () => {
    const { content } = reader();
    const odt = buildZip([
      {
        name: "content.xml",
        content:
          '<office:document-content><office:body><office:text><text:h>Kapitel</text:h><text:p>Erste<text:s text:c="2"/>Seite</text:p><text:soft-page-break/><text:p>Zweite<text:tab/>Seite</text:p></office:text></office:body></office:document-content>',
      },
    ]);
    const text = await content.read(
      source("notiz.odt", "application/vnd.oasis.opendocument.text", odt),
      {},
      true,
    );
    expect(text.result).toMatchObject({
      seiten: 2,
      abschnitte: [
        { ort: "Seite 1", text: "Kapitel\nErste  Seite" },
        { ort: "Seite 2", text: "Zweite\tSeite" },
      ],
    });
    const odp = buildZip([
      {
        name: "content.xml",
        content:
          '<office:presentation><draw:page draw:name="a"><draw:frame><text:p>Start</text:p></draw:frame></draw:page><draw:page draw:name="b"><text:p>Ende</text:p></draw:page></office:presentation>',
      },
    ]);
    const slides = await content.read(
      source(
        "talk.odp",
        "application/vnd.oasis.opendocument.presentation",
        odp,
      ),
      {},
      true,
    );
    expect(slides.result).toMatchObject({
      folien: 2,
      abschnitte: [
        { ort: "Folie 1", text: "Start" },
        { ort: "Folie 2", text: "Ende" },
      ],
    });
  });

  it("redacts credentials in document text", async () => {
    const { content } = reader();
    const bytes = wordFile(
      "<w:p><w:r><w:t>password=hunter2secret</w:t></w:r></w:p>",
    );
    const reading = await content.read(
      source("geheim.docx", WORD_TYPE, bytes),
      {},
      true,
    );
    expect(JSON.stringify(reading.result)).not.toContain("hunter2secret");
    expect(reading.searchText ?? "").not.toContain("hunter2secret");
  });
});

describe("PAGE-386 embedded pictures in documents and PDFs", () => {
  it("returns an embedded picture of a document as an image on request", async () => {
    const { content } = reader();
    const bytes = wordFile("<w:p><w:r><w:t>Mit Bild</w:t></w:r></w:p>", [
      { name: "word/media/image1.png", content: PNG },
    ]);
    const overview = await content.read(
      source("bild.docx", WORD_TYPE, bytes),
      {},
      true,
    );
    expect(overview.result).toMatchObject({ eingebetteteBilder: 1 });
    const picture = await content.read(
      source("bild.docx", WORD_TYPE, bytes),
      { image: 1 },
      true,
    );
    expect(picture.images).toEqual([
      { label: "Bild 1 aus dem Dokument", mimeType: "image/png", data: PNG },
    ]);
    const blind = await content.read(
      source("bild.docx", WORD_TYPE, bytes),
      { image: 1 },
      false,
    );
    expect(blind.images).toEqual([]);
    expect(blind.result).toMatchObject({ bildSichtbar: false });
  });

  it("reads the images of a PDF page through the PDF image reader", async () => {
    const pdfImages = vi.fn().mockResolvedValue([PNG]);
    const { content } = reader({ pdfImages });
    const reading = await content.read(
      source("scan.pdf", "application/pdf", Buffer.from("%PDF-1.4")),
      { image: 3 },
      true,
    );
    expect(pdfImages).toHaveBeenCalledWith(Buffer.from("%PDF-1.4"), 3);
    expect(reading.images).toEqual([
      { label: "Bild 1 auf Seite 3", mimeType: "image/png", data: PNG },
    ]);
  });
});

describe("PAGE-386 macros and embedded programs are never run", () => {
  it("reads only the text of a macro-enabled Word file and leaves its macro project untouched", async () => {
    const { content } = reader();
    const bytes = wordFile("<w:p><w:r><w:t>Rechnung</w:t></w:r></w:p>", [
      {
        name: "word/vbaProject.bin",
        content: Buffer.from('Sub AutoOpen(): Shell "calc": End Sub'),
      },
      {
        name: "word/embeddings/oleObject1.bin",
        content: Buffer.from("MZ executable"),
      },
    ]);
    const reading = await content.read(
      source(
        "rechnung.docm",
        "application/vnd.ms-word.document.macroEnabled.12",
        bytes,
      ),
      {},
      true,
    );
    expect(reading.result).toMatchObject({
      abschnitte: [{ ort: "Text", text: "Rechnung" }],
    });
    const serialized = JSON.stringify(reading);
    expect(serialized).not.toContain("AutoOpen");
    expect(serialized).not.toContain("executable");
    expect(reading.result).not.toHaveProperty("eingebetteteBilder");
  });

  it("never opens a binary file and knows only its facts", async () => {
    const { content } = reader();
    const file = source(
      "setup.exe",
      "application/x-msdownload",
      Buffer.from("MZ"),
    );
    const reading = await content.read(file, {}, true);
    expect(file.open).not.toHaveBeenCalled();
    expect(reading.images).toEqual([]);
    expect(reading.searchText).toBeNull();
    expect(String(reading.result.hinweis)).toContain(
      "Name, Art, Größe und Prüfsumme",
    );
  });
});

describe("PAGE-386 tables", () => {
  it("reads the values of an Excel sheet as header and rows", async () => {
    const { content } = reader();
    const bytes = buildZip(
      workbookParts([
        {
          name: "Umsatz",
          xml: sheetXml([
            [
              { type: "str", value: "Monat" },
              { type: "str", value: "Betrag" },
            ],
            [{ type: "str", value: "Mai" }, { value: "1200" }],
          ]),
        },
      ]),
    );
    const reading = await content.read(
      source(
        "umsatz.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        bytes,
      ),
      {},
      true,
    );
    expect(reading.result).toMatchObject({
      blatt: "Umsatz",
      kopfzeile: ["Monat", "Betrag"],
      zeilen: [{ nr: 1, werte: ["Mai", "1200"] }],
      zeilenGesamt: 1,
      naechsteZeile: null,
    });
  });

  it("reads a semicolon CSV, limits a large table with its full size and reads further rows", async () => {
    const { content } = reader();
    const rows = [
      "Name;Wert",
      ...Array.from(
        { length: 250 },
        (_, index) => `Zeile ${String(index + 1)};${String(index)}`,
      ),
    ];
    const bytes = Buffer.from(rows.join("\n"));
    const first = await content.read(
      source("daten.csv", "text/csv", bytes),
      {},
      true,
    );
    expect(first.result).toMatchObject({
      kopfzeile: ["Name", "Wert"],
      zeilenGesamt: 250,
      naechsteZeile: 201,
    });
    expect(first.result.hinweis).toBe(
      "Gezeigt sind 200 von 250 Zeilen. Weitere mit zeileAb 201.",
    );
    const next = await content.read(
      source("daten.csv", "text/csv", bytes),
      { fromRow: 201 },
      true,
    );
    expect(next.result).toMatchObject({ naechsteZeile: null });
    expect((next.result.zeilen as unknown[])[0]).toEqual({
      nr: 201,
      werte: ["Zeile 201", "200"],
    });
  });

  it("reads quoted CSV fields and the sheets of an OpenDocument spreadsheet", async () => {
    const { content } = reader();
    const csv = await content.read(
      source("q.csv", "text/csv", Buffer.from('a,b\n"x, y","sagt ""hi"""\n')),
      {},
      true,
    );
    expect(csv.result).toMatchObject({
      zeilen: [{ nr: 1, werte: ["x, y", 'sagt "hi"'] }],
    });
    const ods = buildZip([
      {
        name: "content.xml",
        content:
          '<office:spreadsheet><table:table table:name="Kosten"><table:table-row><table:table-cell><text:p>Posten</text:p></table:table-cell><table:table-cell><text:p>Euro</text:p></table:table-cell></table:table-row><table:table-row><table:table-cell><text:p>Miete</text:p></table:table-cell><table:table-cell office:value="900"><text:p>900</text:p></table:table-cell><table:table-cell table:number-columns-repeated="1000"/></table:table-row><table:table-row table:number-rows-repeated="1048570"><table:table-cell table:number-columns-repeated="1024"/></table:table-row></table:table></office:spreadsheet>',
      },
    ]);
    const sheet = await content.read(
      source("k.ods", "application/vnd.oasis.opendocument.spreadsheet", ods),
      { sheet: "kosten" },
      true,
    );
    expect(sheet.result).toMatchObject({
      blatt: "Kosten",
      kopfzeile: ["Posten", "Euro"],
      zeilen: [{ nr: 1, werte: ["Miete", "900"] }],
      zeilenGesamt: 1,
    });
  });
});

describe("PAGE-386 sounds and videos", () => {
  it("gives the spoken text of an audio file and keeps it for the search", async () => {
    const { content, transcribe } = reader();
    const reading = await content.read(
      source("memo.m4a", "audio/mp4", Buffer.from("audio")),
      {},
      true,
    );
    expect(transcribe).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: "audio/mp4", sizeBytes: 5 }),
    );
    expect(reading.result).toEqual({
      gesprochenerText: "Hallo zusammen, das Deployment ist kaputt.",
    });
    expect(reading.searchText).toBe(
      "Hallo zusammen, das Deployment ist kaputt.",
    );
  });

  it("names music without speech instead of a text", async () => {
    const { content } = reader({
      transcribe: vi.fn().mockResolvedValue({ ok: false }),
    });
    const reading = await content.read(
      source("song.mp3", "audio/mpeg", Buffer.from("x")),
      {},
      true,
    );
    expect(String(reading.result.hinweis)).toContain("Musik ohne Sprache");
    expect(reading.searchText).toBeNull();
  });

  it("reuses a recognized text instead of recognizing again", async () => {
    const { content, transcribe } = reader();
    const reading = await content.read(
      source("memo.m4a", "audio/mp4", Buffer.from("audio"), {
        knownText: "schon erkannt",
      }),
      {},
      true,
    );
    expect(transcribe).not.toHaveBeenCalled();
    expect(reading.result).toEqual({ gesprochenerText: "schon erkannt" });
  });

  it("gives the text of the sound track and evenly spaced stills of a video", async () => {
    const frames = { frames: vi.fn().mockResolvedValue([PNG, PNG]) };
    const { content } = reader({ frames });
    const reading = await content.read(
      source("demo.mp4", "video/mp4", Buffer.from("video"), {
        durationSeconds: 40,
      }),
      {},
      true,
    );
    expect(frames.frames).toHaveBeenCalledWith(expect.any(Function), 40);
    expect(reading.result).toMatchObject({
      laengeSekunden: 40,
      textDerTonspur: "Hallo zusammen, das Deployment ist kaputt.",
      standbilder: ["Standbild 1 von 2", "Standbild 2 von 2"],
    });
    expect(reading.images).toHaveLength(2);
  });

  it("falls back to the preview image without a frame reader and gives no stills to a blind model", async () => {
    const { content } = reader({
      frames: { frames: vi.fn().mockResolvedValue(null) },
    });
    const preview = {
      open: () => Readable.from([PNG]),
      mimeType: "image/webp",
    };
    const seen = await content.read(
      source("v.webm", "video/webm", Buffer.from("v"), { preview }),
      {},
      true,
    );
    expect(seen.images).toEqual([
      { label: "Vorschaubild des Videos", mimeType: "image/webp", data: PNG },
    ]);
    const blind = await content.read(
      source("v.webm", "video/webm", Buffer.from("v"), { preview }),
      {},
      false,
    );
    expect(blind.images).toEqual([]);
    expect(blind.result).toMatchObject({
      textDerTonspur: "Hallo zusammen, das Deployment ist kaputt.",
      standbilder: [],
    });
  });
});

describe("PAGE-386 kinds", () => {
  it("classifies by type and by name", () => {
    expect(agentAttachmentKind("a.png", "image/png")).toBe("image");
    expect(agentAttachmentKind("a.bin", "application/pdf")).toBe("pdf");
    expect(agentAttachmentKind("a.odt", "application/octet-stream")).toBe(
      "word",
    );
    expect(agentAttachmentKind("a.pptm", "application/octet-stream")).toBe(
      "slides",
    );
    expect(agentAttachmentKind("a.tsv", "application/octet-stream")).toBe(
      "sheet",
    );
    expect(agentAttachmentKind("a.md", "application/octet-stream")).toBe(
      "text",
    );
    expect(agentAttachmentKind("a.ogg", "audio/ogg")).toBe("audio");
    expect(agentAttachmentKind("a.mov", "video/quicktime")).toBe("video");
    expect(agentAttachmentKind("a.zip", "application/zip")).toBe("binary");
    expect(agentAttachmentKind("a.doc", "application/msword")).toBe("binary");
  });
});
