import { deflateRawSync } from "node:zlib";

/** One part of a test archive: its path and its text or bytes. */
export type FixturePart = readonly [string, string | Uint8Array];

/**
 * Builds a ZIP archive like Office and LibreOffice write it, for the tests of
 * the document readers (PAGE-385): every part deflated, a central directory
 * at the end.
 *
 * @param parts - The parts in their order.
 * @param options - `isEncrypted` marks every part as encrypted.
 */
export function zipOf(parts: readonly FixturePart[], options: { readonly isEncrypted?: boolean } = {}): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of parts) {
    const raw = typeof content === "string" ? Buffer.from(content) : Buffer.from(content);
    const data = deflateRawSync(raw);
    const nameBytes = Buffer.from(name);
    const flags = options.isEncrypted ? 1 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(parts.length, 8);
  end.writeUInt16LE(parts.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingprocessingml/2006/wordprocessingDrawing"';

/** A tiny PNG of one pixel. */
export const PIXEL_PNG = new Uint8Array(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"),
);

/** A Word document with headings, emphasis, a list, a table, an image, a link, a macro and an external picture. */
export function docxFixture(): Uint8Array {
  const document = `<?xml version="1.0" encoding="UTF-8"?>
<w:document ${W}><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Quartalsbericht</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Der Umsatz ist </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>deutlich</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve"> gestiegen</w:t></w:r><w:r><w:t>.</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Erster Punkt</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>Schritt eins</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Region</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Umsatz</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>Nord</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>1200</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="Bild 1" descr="Diagramm"/><a:graphic><a:graphicData><a:blip r:embed="rId5"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
<w:p><w:r><w:drawing><wp:inline><wp:docPr id="2" name="Fern"/><a:graphic><a:graphicData><a:blip r:link="rId6"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
<w:p><w:hyperlink r:id="rId7"><w:r><w:t>Webseite</w:t></w:r></w:hyperlink><w:r><w:br w:type="page"/></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Ausblick</w:t></w:r></w:p>
<w:p><w:r><w:object><w:t>ignored</w:t></w:object></w:r></w:p>
</w:body></w:document>`;
  const styles = `<w:styles ${W}><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>`;
  const numbering = `<w:numbering ${W}><w:abstractNum w:abstractNumId="10"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="11"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="10"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="11"/></w:num></w:numbering>`;
  const relations = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId5" Type="image" Target="media/image1.png"/>
<Relationship Id="rId6" Type="image" Target="https://tracker.example/pixel.png" TargetMode="External"/>
<Relationship Id="rId7" Type="hyperlink" Target="https://pages.example/" TargetMode="External"/>
</Relationships>`;
  return zipOf([
    ["[Content_Types].xml", "<Types/>"],
    ["word/document.xml", document],
    ["word/styles.xml", styles],
    ["word/numbering.xml", numbering],
    ["word/_rels/document.xml.rels", relations],
    ["word/media/image1.png", PIXEL_PNG],
    ["word/vbaProject.bin", "Sub AutoOpen(): Shell \"calc\": End Sub"],
    ["docProps/app.xml", "<Properties><Pages>3</Pages></Properties>"],
    ["docProps/core.xml", '<cp:coreProperties xmlns:cp="c" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Bericht Q3</dc:title></cp:coreProperties>'],
  ]);
}

const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function slideXml(title: string, body: string, extra = ""): string {
  return `<p:sld ${P}><p:cSld><p:spTree>
<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:rPr b="1"/><a:t>${body}</a:t></a:r></a:p></p:txBody></p:sp>
${extra}</p:spTree></p:cSld></p:sld>`;
}

/** A presentation of two slides, the second with a picture. */
export function pptxFixture(): Uint8Array {
  const presentation = `<p:presentation ${P}><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst></p:presentation>`;
  const relations = `<Relationships><Relationship Id="rId2" Target="slides/slide1.xml"/><Relationship Id="rId3" Target="slides/slide2.xml"/></Relationships>`;
  const picture = `<p:pic><p:nvPicPr><p:cNvPr id="4" name="Bild" descr="Logo"/></p:nvPicPr><p:blipFill><a:blip r:embed="rId9"/></p:blipFill></p:pic>`;
  return zipOf([
    ["ppt/presentation.xml", presentation],
    ["ppt/_rels/presentation.xml.rels", relations],
    ["ppt/slides/slide1.xml", slideXml("Willkommen", "Agenda")],
    ["ppt/slides/slide2.xml", slideXml("Zahlen", "Wachstum", picture)],
    ["ppt/slides/_rels/slide2.xml.rels", `<Relationships><Relationship Id="rId9" Target="../media/image1.png"/></Relationships>`],
    ["ppt/media/image1.png", PIXEL_PNG],
  ]);
}

const S = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** A workbook with two visible sheets, a hidden one, a formula, a date and a percentage. */
export function xlsxFixture(): Uint8Array {
  const workbook = `<workbook ${S}><sheets><sheet name="Umsatz" sheetId="1" r:id="rId1"/><sheet name="Geheim" sheetId="2" state="hidden" r:id="rId2"/><sheet name="Kosten" sheetId="3" r:id="rId3"/></sheets></workbook>`;
  const relations = `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Target="/xl/worksheets/sheet3.xml"/></Relationships>`;
  const strings = `<sst ${S}><si><t>Region</t></si><si><t>Umsatz</t></si><si><r><t>No</t></r><r><t>rd</t></r></si><si><t>Datum</t></si></sst>`;
  const styles = `<styleSheet ${S}><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="10"/></cellXfs></styleSheet>`;
  const sheet1 = `<worksheet ${S}><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>3</v></c><c r="D1" t="inlineStr"><is><t>Anteil</t></is></c></row>
<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1200.5</v></c><c r="C2" s="1"><v>45611</v></c><c r="D2" s="2"><v>0.25</v></c></row>
<row r="4"><c r="A4" t="str"><f>"Su"&amp;"mme"</f><v>Summe</v></c><c r="B4"><f>SUM(B2:B3)</f><v>1200.5</v></c></row>
</sheetData></worksheet>`;
  return zipOf([
    ["xl/workbook.xml", workbook],
    ["xl/_rels/workbook.xml.rels", relations],
    ["xl/sharedStrings.xml", strings],
    ["xl/styles.xml", styles],
    ["xl/worksheets/sheet1.xml", sheet1],
    ["xl/worksheets/sheet2.xml", `<worksheet ${S}><sheetData/></worksheet>`],
    ["xl/worksheets/sheet3.xml", `<worksheet ${S}><sheetData><row r="1"><c r="B1"><v>7</v></c></row></sheetData></worksheet>`],
  ]);
}

const O = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/"';

/** An OpenDocument text with a heading, emphasis, an ordered list, a table, an image and an external picture. */
export function odtFixture(): Uint8Array {
  const content = `<office:document-content ${O}><office:automatic-styles>
<style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>
<text:list-style style:name="L1"><text:list-level-style-number text:level="1"/></text:list-style>
</office:automatic-styles><office:body><office:text>
<text:h text:outline-level="1">Protokoll</text:h>
<text:p>Es gilt <text:span text:style-name="T1">ab sofort</text:span>.<text:s text:c="2"/>Ende</text:p>
<text:list text:style-name="L1"><text:list-item><text:p>Punkt A</text:p></text:list-item><text:list-item><text:p>Punkt B</text:p></text:list-item></text:list>
<table:table><table:table-row><table:table-cell><text:p>Name</text:p></table:table-cell><table:table-cell><text:p>Rolle</text:p></table:table-cell></table:table-row></table:table>
<text:p><draw:frame draw:name="Foto"><draw:image xlink:href="Pictures/a.png"/></draw:frame><draw:frame draw:name="Fern"><draw:image xlink:href="https://tracker.example/x.png"/></draw:frame></text:p>
<text:p><draw:frame draw:name="Objekt"><draw:object xlink:href="./Object 1"/></draw:frame></text:p>
</office:text></office:body></office:document-content>`;
  const meta = `<office:document-meta ${O}><office:meta><dc:title>Sitzung</dc:title><meta:document-statistic meta:page-count="2"/></office:meta></office:document-meta>`;
  return zipOf([
    ["mimetype", "application/vnd.oasis.opendocument.text"],
    ["content.xml", content],
    ["meta.xml", meta],
    ["Pictures/a.png", PIXEL_PNG],
    ["Basic/Standard/Module1.xml", "<script>Shell(\"calc\")</script>"],
  ]);
}

/** An OpenDocument presentation of two pages. */
export function odpFixture(): Uint8Array {
  const content = `<office:document-content ${O}><office:body><office:presentation>
<draw:page draw:name="Seite 1"><draw:frame presentation:class="title"><draw:text-box><text:p>Start</text:p></draw:text-box></draw:frame><draw:frame presentation:class="outline"><draw:text-box><text:list><text:list-item><text:p>Ziel</text:p></text:list-item></text:list></draw:text-box></draw:frame></draw:page>
<draw:page draw:name="Seite 2"><draw:frame><draw:image xlink:href="Pictures/a.png"/></draw:frame></draw:page>
</office:presentation></office:body></office:document-content>`;
  return zipOf([["content.xml", content], ["Pictures/a.png", PIXEL_PNG]]);
}

/** An OpenDocument spreadsheet with repeated empty rows and cells. */
export function odsFixture(): Uint8Array {
  const content = `<office:document-content ${O}><office:body><office:spreadsheet>
<table:table table:name="Liste">
<table:table-row><table:table-cell office:value-type="string"><text:p>Artikel</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Preis</text:p></table:table-cell></table:table-row>
<table:table-row><table:table-cell office:value-type="string"><text:p>Tee</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="3.5"><text:p>3,50</text:p></table:table-cell><table:table-cell table:number-columns-repeated="16380"/></table:table-row>
<table:table-row table:number-rows-repeated="1048570"><table:table-cell table:number-columns-repeated="16384"/></table:table-row>
</table:table><table:table table:name="Leer"/>
</office:spreadsheet></office:body></office:document-content>`;
  return zipOf([["content.xml", content]]);
}
