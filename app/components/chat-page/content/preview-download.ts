import type { PreviewFile } from "./preview-kinds";

/** Name of the archive of a preview with several files. */
export const PREVIEW_ARCHIVE_NAME = "preview.zip";

const MIME_TYPES: Readonly<Record<string, string>> = {
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  js: "text/javascript",
  svg: "image/svg+xml",
  json: "application/json",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
};

let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
  crcTable ??= Uint32Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1)
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
  });
  const table = crcTable;
  let crc = 0xffffffff;
  for (const byte of bytes)
    crc = (table[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** One file as the archive stores it, with the offset of its local header. */
interface ZipEntry {
  readonly name: Uint8Array;
  readonly content: Uint8Array;
  readonly crc: number;
  readonly offset: number;
}

function header(size: number, fill: (view: DataView) => void): Uint8Array {
  const bytes = new Uint8Array(size);
  fill(new DataView(bytes.buffer));
  return bytes;
}

/** The fields local and central headers share: version, flags, method, time, CRC and sizes. */
function writeCommon(view: DataView, at: number, entry: ZipEntry): void {
  view.setUint16(at, 20, true);
  // Bit 11: the names are UTF-8.
  view.setUint16(at + 2, 0x0800, true);
  view.setUint16(at + 4, 0, true);
  view.setUint16(at + 6, 0, true);
  view.setUint16(at + 8, 0x21, true);
  view.setUint32(at + 10, entry.crc, true);
  view.setUint32(at + 14, entry.content.length, true);
  view.setUint32(at + 18, entry.content.length, true);
  view.setUint16(at + 22, entry.name.length, true);
}

/**
 * Packs text files into a ZIP archive without compression (PAGE-383), for
 * "Herunterladen" of a preview with several files.
 *
 * @param files - Names and contents; names keep their folders.
 * @returns The bytes of the archive.
 */
export function createZipArchive(
  files: readonly { readonly name: string; readonly source: string }[],
): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const entries: ZipEntry[] = [];
  let offset = 0;
  for (const file of files) {
    const content = encoder.encode(file.source);
    const entry = {
      name: encoder.encode(file.name),
      content,
      crc: crc32(content),
      offset,
    };
    const local = header(30, (view) => {
      view.setUint32(0, 0x04034b50, true);
      writeCommon(view, 4, entry);
    });
    parts.push(local, entry.name, content);
    entries.push(entry);
    offset += local.length + entry.name.length + content.length;
  }
  let centralSize = 0;
  for (const entry of entries) {
    const central = header(46, (view) => {
      view.setUint32(0, 0x02014b50, true);
      view.setUint16(4, 20, true);
      writeCommon(view, 6, entry);
      view.setUint32(42, entry.offset, true);
    });
    parts.push(central, entry.name);
    centralSize += central.length + entry.name.length;
  }
  parts.push(
    header(22, (view) => {
      view.setUint32(0, 0x06054b50, true);
      view.setUint16(8, entries.length, true);
      view.setUint16(10, entries.length, true);
      view.setUint32(12, centralSize, true);
      view.setUint32(16, offset, true);
    }),
  );
  const archive = new Uint8Array(offset + centralSize + 22);
  let position = 0;
  for (const part of parts) {
    archive.set(part, position);
    position += part.length;
  }
  return archive;
}

function mimeTypeOf(name: string): string {
  return (
    MIME_TYPES[name.slice(name.lastIndexOf(".") + 1).toLowerCase()] ??
    "text/plain"
  );
}

/**
 * Offers a blob as a download of the browser.
 *
 * @param fileName - The name the file is offered with.
 * @param blob - Its content.
 */
export function saveBlobFile(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Downloads the code of a preview (PAGE-383): one file as itself, several
 * files as `preview.zip`.
 *
 * @param files - The files of the preview.
 */
export function downloadPreviewFiles(files: readonly PreviewFile[]): void {
  const [first] = files;
  if (!first) return;
  if (files.length === 1) {
    saveBlobFile(
      first.name,
      new Blob([first.source], { type: mimeTypeOf(first.name) }),
    );
    return;
  }
  const archive = createZipArchive(files);
  saveBlobFile(
    PREVIEW_ARCHIVE_NAME,
    new Blob([archive.slice().buffer], { type: "application/zip" }),
  );
}
