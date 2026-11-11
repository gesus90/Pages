import { describe, expect, it } from "vitest";

import { CHAT_OFFICE_TYPES } from "@/definition/ChatPreview";
import { readOfficeDocument } from "@/backend/service/chat/ChatOfficeText";

import { buildZip } from "./office-zip-fixture";

function slide(...paragraphs: string[]): string {
  return `<p:sld>${paragraphs
    .map((text) => `<a:p><a:r><a:t>${text}</a:t></a:r></a:p>`)
    .join("")}</p:sld>`;
}

describe("readOfficeDocument for presentations", () => {
  it("reads slides in numeric order and numbers the non-empty ones consecutively", () => {
    const bytes = buildZip([
      { name: "ppt/slides/slide10.xml", content: slide("Zehn") },
      { name: "ppt/slides/slide2.xml", content: slide("Zwei", "Absatz") },
      { name: "ppt/slides/slide1.xml", content: "<p:sld><a:p></a:p></p:sld>" },
      { name: "ppt/slides/slideX.xml", content: slide("Ignoriert") },
      { name: "ppt/slides/slide3.xml.rels", content: slide("Ignoriert") },
      { name: "ppt/notesSlides/slide4.xml", content: slide("Notiz") },
    ]);
    expect(readOfficeDocument(CHAT_OFFICE_TYPES.presentation, bytes)).toEqual({
      sections: [
        { kind: "slide", number: 2, text: "Zwei\nAbsatz" },
        { kind: "slide", number: 3, text: "Zehn" },
      ],
      sheets: [],
      isTruncated: false,
    });
  });

  it("reads drawing tabs and line breaks inside a slide", () => {
    const bytes = buildZip([
      {
        name: "ppt/slides/slide1.xml",
        content:
          "<a:p><a:t>A</a:t><a:tab/><a:t>B</a:t><a:br/><a:t>C</a:t></a:p>",
      },
    ]);
    const document = readOfficeDocument(CHAT_OFFICE_TYPES.presentation, bytes);
    expect(document?.sections).toEqual([
      { kind: "slide", number: 1, text: "A\tB\nC" },
    ]);
  });

  it("stops after 200 slides and marks the reading truncated", () => {
    const bytes = buildZip(
      Array.from(Array(201).keys(), (index) => ({
        name: `ppt/slides/slide${index + 1}.xml`,
        content: slide(`Folie ${index + 1}`),
      })),
    );
    const document = readOfficeDocument(CHAT_OFFICE_TYPES.presentation, bytes);
    expect(document?.sections).toHaveLength(200);
    expect(document?.sections.at(-1)).toEqual({
      kind: "slide",
      number: 200,
      text: "Folie 200",
    });
    expect(document?.isTruncated).toBe(true);
  });

  it("does not mark exactly 200 slides truncated", () => {
    const bytes = buildZip(
      Array.from(Array(200).keys(), (index) => ({
        name: `ppt/slides/slide${index + 1}.xml`,
        content: slide("x"),
      })),
    );
    const document = readOfficeDocument(CHAT_OFFICE_TYPES.presentation, bytes);
    expect(document?.sections).toHaveLength(200);
    expect(document?.isTruncated).toBe(false);
  });

  it("returns no sections for a package without slides", () => {
    const bytes = buildZip([{ name: "ppt/presentation.xml", content: "<p/>" }]);
    expect(readOfficeDocument(CHAT_OFFICE_TYPES.presentation, bytes)).toEqual({
      sections: [],
      sheets: [],
      isTruncated: false,
    });
  });
});
