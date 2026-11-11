import { describe, expect, it } from "vitest";

import { CHAT_OFFICE_TYPES } from "@/definition/ChatPreview";
import { readOfficeDocument } from "@/backend/service/chat/ChatOfficeText";

import {
  UNRELATED_PART,
  buildZip,
  sheetXml,
  workbookParts,
} from "./office-zip-fixture";

import type { ChatDocument } from "@/backend/service/chat/ChatDocumentReader";
import type { ZipPart } from "./office-zip-fixture";

function readWorkbook(parts: readonly ZipPart[]): ChatDocument | null {
  return readOfficeDocument(CHAT_OFFICE_TYPES.workbook, buildZip(parts));
}

describe("readOfficeDocument for workbook structure", () => {
  it("stops at 1000 rows and marks the reading truncated", () => {
    const rows = Array.from(Array(1_001).keys(), (index) => [
      { value: String(index) },
    ]);
    const document = readWorkbook(
      workbookParts([{ name: "S", xml: sheetXml(rows) }]),
    );
    expect(document?.sheets[0].rows).toHaveLength(1_000);
    expect(document?.sheets[0].rows[999]).toEqual(["999"]);
    expect(document?.isTruncated).toBe(true);
  });

  it("reads 200 sheets and marks more than 200 truncated", () => {
    const sheets = (count: number): { name: string; xml: string }[] =>
      Array.from(Array(count).keys(), (index) => ({
        name: `S${index + 1}`,
        xml: sheetXml([[{ value: "v" }]]),
      }));
    const exact = readWorkbook(workbookParts(sheets(200)));
    expect(exact?.sheets).toHaveLength(200);
    expect(exact?.isTruncated).toBe(false);
    const over = readWorkbook(workbookParts(sheets(201)));
    expect(over?.sheets).toHaveLength(200);
    expect(over?.isTruncated).toBe(true);
  });

  it("follows only internal relationships and resolves absolute targets from the root", () => {
    const relations =
      "<Relationships>" +
      '<Relationship Id="rId1" Target="/xl/data/one.xml"/>' +
      '<Relationship Id="rId2" Target="https://example.test/x.xml" TargetMode="External"/>' +
      '<Relationship Id="rId3" Target=""/>' +
      '<Relationship Target="missing-id.xml"/>' +
      "</Relationships></Relationship>";
    const workbook =
      "<workbook><sheets>" +
      '<sheet name="Eins" r:id="rId1"/><sheet name="Extern" r:id="rId2"/>' +
      '<sheet name="Leer" r:id="rId3"/><sheet name="Unbekannt" r:id="rId9"/>' +
      '<sheet name="Ohne"/></sheets></sheet></workbook>';
    const document = readWorkbook([
      { name: "xl/workbook.xml", content: workbook },
      { name: "xl/_rels/workbook.xml.rels", content: relations },
      { name: "xl/data/one.xml", content: sheetXml([[{ value: "1" }]]) },
    ]);
    expect(document?.sheets).toEqual([{ name: "Eins", rows: [["1"]] }]);
  });

  it("uses an empty name for a sheet without one and an empty sheet for a missing part", () => {
    const document = readWorkbook([
      {
        name: "xl/workbook.xml",
        content: '<workbook><sheet r:id="rId1"/></workbook>',
      },
      {
        name: "xl/_rels/workbook.xml.rels",
        content:
          '<Relationships><Relationship Id="rId1" Target="gone.xml"/></Relationships>',
      },
    ]);
    expect(document).toEqual({
      sections: [],
      sheets: [{ name: "", rows: [] }],
      isTruncated: false,
    });
  });

  it("returns no sheets for a package without workbook parts", () => {
    expect(readWorkbook([UNRELATED_PART])).toEqual({
      sections: [],
      sheets: [],
      isTruncated: false,
    });
  });
});
