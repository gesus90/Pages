import { describe, expect, it } from "vitest";

import { CHAT_OFFICE_TYPES } from "@/definition/ChatPreview";
import { ChatZipError } from "@/backend/service/chat/ChatZipArchive";
import { readOfficeDocument } from "@/backend/service/chat/ChatOfficeText";

import type { ChatDocument } from "@/backend/service/chat/ChatDocumentReader";

import { UNRELATED_PART, buildZip } from "./office-zip-fixture";

function readWord(xml: string | null): ChatDocument | null {
  const parts =
    xml === null
      ? [UNRELATED_PART]
      : [{ name: "word/document.xml", content: xml }];
  return readOfficeDocument(CHAT_OFFICE_TYPES.document, buildZip(parts));
}

describe("readOfficeDocument for Word and unknown types", () => {
  it("joins the paragraphs of a Word document with tabs and line breaks", () => {
    const xml =
      "<w:document><w:body>" +
      "<w:p><w:r><w:t>Hallo</w:t><w:tab/><w:t>Welt</w:t></w:r></w:p>" +
      "<w:p><w:r><w:t>Zeile</w:t><w:br/><w:t>zwei</w:t></w:r></w:p>" +
      "</w:body></w:document>";
    expect(readWord(xml)).toEqual({
      sections: [
        { kind: "document", number: 1, text: "Hallo\tWelt\nZeile\nzwei" },
      ],
      sheets: [],
      isTruncated: false,
    });
  });

  it("ignores closing tab and break tags, empty text elements and text outside w:t", () => {
    const xml =
      "<w:p>ignored<w:t>A</w:t></w:tab></w:br><w:t/>hidden<w:t>B</w:t></w:p>";
    expect(readWord(xml)?.sections[0].text).toBe("AB");
  });

  it("decodes named, decimal and hexadecimal entities and drops invalid code points", () => {
    const xml =
      "<w:p><w:t>&lt;a&gt; &amp; &quot;b&quot; &apos;c&apos; &#65;&#x42;" +
      "&#0;&#1114112;&#x110000;&unknown;</w:t></w:p>";
    expect(readWord(xml)?.sections[0].text).toBe(`<a> & "b" 'c' AB&unknown;`);
  });

  it("collapses runs of blank paragraphs, trims paragraph ends and the whole text", () => {
    const xml =
      "<w:p><w:t>Eins   </w:t></w:p><w:p></w:p><w:p></w:p><w:p></w:p>" +
      "<w:p><w:t>Zwei</w:t></w:p><w:p></w:p>";
    expect(readWord(xml)?.sections[0].text).toBe("Eins\n\nZwei");
  });

  it("returns no section for an empty or missing document part", () => {
    const empty = { sections: [], sheets: [], isTruncated: false };
    expect(readWord("<w:document><w:p></w:p></w:document>")).toEqual(empty);
    expect(readWord(null)).toEqual(empty);
  });

  it("returns null for a content type that is no Office format", () => {
    expect(
      readOfficeDocument("application/pdf", buildZip([UNRELATED_PART])),
    ).toBeNull();
  });

  it("refuses a package without a central directory", () => {
    expect(() =>
      readOfficeDocument(CHAT_OFFICE_TYPES.document, Buffer.from("no zip")),
    ).toThrow(ChatZipError);
  });
});
