import { describe, expect, it } from "vitest";

import { CHAT_OFFICE_TYPES } from "@/definition/ChatPreview";
import { readOfficeDocument } from "@/backend/service/chat/ChatOfficeText";

import { buildZip, sheetXml, workbookParts } from "./office-zip-fixture";

import type { ChatDocument } from "@/backend/service/chat/ChatDocumentReader";
import type { ZipPart } from "./office-zip-fixture";

function readWorkbook(parts: readonly ZipPart[]): ChatDocument | null {
  return readOfficeDocument(CHAT_OFFICE_TYPES.workbook, buildZip(parts));
}

describe("readOfficeDocument for workbook cells", () => {
  it("reads sheets in workbook order with shared strings, booleans and numbers", () => {
    const shared: ZipPart = {
      name: "xl/sharedStrings.xml",
      content:
        "<sst><si><t>Name</t></si><si><r><t>Ra</t></r><r><t>w &amp; Co</t></r></si>" +
        "<si><t/></si></sst>",
    };
    const sheet = sheetXml([
      [
        { ref: "A1", type: "s", value: "0" },
        { ref: "B1", type: "s", value: "1" },
        { ref: "C1", type: "s", value: "99" },
      ],
      [
        { ref: "A2", type: "b", value: "1" },
        { ref: "B2", type: "b", value: "0" },
        { ref: "C2", value: "3.5" },
      ],
    ]);
    const document = readWorkbook(
      workbookParts([{ name: "Tabelle &amp; 1", xml: sheet }], [shared]),
    );
    expect(document).toEqual({
      sections: [],
      sheets: [
        {
          name: "Tabelle & 1",
          rows: [
            ["Name", "Raw & Co", ""],
            ["WAHR", "FALSCH", "3.5"],
          ],
        },
      ],
      isTruncated: false,
    });
  });

  it("places cells by column reference, fills gaps and falls back to the position without one", () => {
    const sheet = sheetXml([
      [
        { ref: "C1", value: "c" },
        { ref: "A1", value: "a" },
      ],
      [{ value: "x" }, { ref: "invalid", value: "y" }],
    ]);
    const document = readWorkbook(workbookParts([{ name: "S", xml: sheet }]));
    expect(document?.sheets[0].rows).toEqual([
      ["a", "", "c"],
      ["x", "y"],
    ]);
  });

  it("decodes two-letter column references", () => {
    const sheet = sheetXml([[{ ref: "AB1", value: "z" }]]);
    const rows = readWorkbook(workbookParts([{ name: "S", xml: sheet }]))
      ?.sheets[0].rows;
    expect(rows?.[0]).toHaveLength(28);
    expect(rows?.[0][27]).toBe("z");
  });

  it("keeps empty rows, skips self-closing cells and reads inline strings", () => {
    const sheet =
      '<worksheet><sheetData><row/><row><c r="A1"/><c r="B1" t="inlineStr"><is><t>inline</t></is></c></row>' +
      "<row></row></sheetData></worksheet>";
    const rows = readWorkbook(workbookParts([{ name: "S", xml: sheet }]))
      ?.sheets[0].rows;
    expect(rows).toEqual([[], ["", "inline"], []]);
  });

  it("ignores text outside values and cells outside rows", () => {
    const sheet =
      '<worksheet>loose<c r="A1"><v>orphan</v></c><row><c r="A1">stray<v>kept</v>' +
      "<f>1+1</f></c></row></worksheet>";
    const rows = readWorkbook(workbookParts([{ name: "S", xml: sheet }]))
      ?.sheets[0].rows;
    expect(rows).toEqual([["kept"]]);
  });

  it("marks the reading truncated for columns beyond 50 and drops those cells", () => {
    const sheet = sheetXml([
      [
        { ref: "AX1", value: "last" },
        { ref: "AY1", value: "dropped" },
      ],
    ]);
    const document = readWorkbook(workbookParts([{ name: "S", xml: sheet }]));
    expect(document?.isTruncated).toBe(true);
    expect(document?.sheets[0].rows[0]).toHaveLength(50);
    expect(document?.sheets[0].rows[0][49]).toBe("last");
  });

  it("ignores text outside t elements in shared strings and a closing cell without an opening one", () => {
    const shared: ZipPart = {
      name: "xl/sharedStrings.xml",
      content: "<sst><si>loose<t>kept</t>tail</si></sst>",
    };
    const sheet =
      '<worksheet><c><v>orphan</v></c></c><row><c t="s"><v>0</v></c></c></row></worksheet>';
    const document = readWorkbook(
      workbookParts([{ name: "S", xml: sheet }], [shared]),
    );
    expect(document?.sheets[0].rows).toEqual([["kept"]]);
  });
});
