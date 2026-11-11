import { deflateRawSync } from "node:zlib";

/** One part of a synthetic ZIP package. */
export interface ZipPart {
  readonly name: string;
  readonly content: string;
}

/** A part that no Office reader looks at, for packages that need some directory entry. */
export const UNRELATED_PART: ZipPart = {
  name: "docProps/app.xml",
  content: "<Properties/>",
};

/** Builds a minimal ZIP package whose parts are deflated, in the given order. */
export function buildZip(parts: readonly ZipPart[]): Buffer {
  const locals: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const part of parts) {
    const name = Buffer.from(part.name, "utf8");
    const raw = Buffer.from(part.content, "utf8");
    const compressed = deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(compressed.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    locals.push(local, name, compressed);
    directory.push(entry, name);
    offset += local.length + name.length + compressed.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(parts.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

/** A cell of a synthetic sheet row: reference, optional type and raw inner XML. */
export interface SheetCell {
  readonly ref?: string;
  readonly type?: string;
  readonly value: string;
}

/** Writes `<row>` elements around cells, each row `<c>` with a `<v>` value. */
export function sheetXml(rows: readonly (readonly SheetCell[])[]): string {
  const body = rows
    .map((cells) => {
      const xml = cells
        .map(({ ref, type, value }) => {
          const r = ref === undefined ? "" : ` r="${ref}"`;
          const t = type === undefined ? "" : ` t="${type}"`;
          return `<c${r}${t}><v>${value}</v></c>`;
        })
        .join("");
      return `<row>${xml}</row>`;
    })
    .join("");
  return `<worksheet><sheetData>${body}</sheetData></worksheet>`;
}

/** The workbook, relationship and sheet parts for the given sheet names and XML. */
export function workbookParts(
  sheets: readonly { name: string; xml: string }[],
  extras: readonly ZipPart[] = [],
): ZipPart[] {
  const sheetTags = sheets
    .map(
      ({ name }, index) =>
        `<sheet name="${name}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    )
    .join("");
  const relations = Array.from(
    sheets.keys(),
    (index) =>
      `<Relationship Id="rId${index + 1}" Target="worksheets/sheet${index + 1}.xml"/>`,
  ).join("");
  return [
    {
      name: "xl/workbook.xml",
      content: `<workbook><sheets>${sheetTags}</sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: `<Relationships>${relations}</Relationships>`,
    },
    ...sheets.map(({ xml }, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      content: xml,
    })),
    ...extras,
  ];
}
