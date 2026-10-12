import { ChatError } from "@/backend/error/ChatErrors";
import { detectFileType } from "@/backend/service/wiki/WikiFileTypes";

import type { ChatFileFacts } from "./ChatFileProbe";

/** The type of an accepted attachment and how the agent may read it. */
export interface ChatFileType {
  readonly contentType: string;
  /** Text files reach the agent as text; every other file only by name and type. */
  readonly isText: boolean;
}

const IMAGE_TYPES: ReadonlyMap<string, string> = new Map([
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
]);

/** Office files are ZIP packages that must contain the main part of their kind. */
const OFFICE_TYPES: ReadonlyMap<
  string,
  { readonly contentType: string; readonly part: string }
> = new Map([
  [
    "docx",
    {
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      part: "word/document.xml",
    },
  ],
  [
    "xlsx",
    {
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      part: "xl/workbook.xml",
    },
  ],
  [
    "pptx",
    {
      contentType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      part: "ppt/presentation.xml",
    },
  ],
]);

const TEXT_TYPES: ReadonlyMap<string, string> = new Map([
  ["txt", "text/plain"],
  ["md", "text/markdown"],
  ["markdown", "text/markdown"],
  ["csv", "text/csv"],
  ["json", "application/json"],
]);

/** Source code is accepted as plain text; scripts of operating systems are not. */
const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
  "c",
  "cc",
  "cjs",
  "cpp",
  "cs",
  "css",
  "go",
  "h",
  "hpp",
  "html",
  "java",
  "js",
  "jsx",
  "kt",
  "mjs",
  "php",
  "py",
  "rb",
  "rs",
  "scss",
  "sql",
  "swift",
  "toml",
  "ts",
  "tsx",
  "xml",
  "yaml",
  "yml",
]);

/** Parts of an Office package that carry executable content: macros, ActiveX, OLE objects and programs. */
const EXECUTABLE_PART =
  /(?:^|\/)vbaProject\.bin$|\/(?:embeddings|activeX)\/[^/]*\.bin$|\.(?:exe|dll|com|bat|cmd|msi|ps1|vbs|vbe|wsf|scr|jar|sh|so|dylib)$/iu;

/** Magic numbers of ELF, Mach-O, Java class and WebAssembly files. */
const EXECUTABLE_MAGIC: ReadonlySet<string> = new Set([
  "7f454c46",
  "feedface",
  "feedfacf",
  "cefaedfe",
  "cffaedfe",
  "cafebabe",
  "0061736d",
]);

const ZIP_LOCAL_HEADER = "504b0304";
const ZIP_END_SIGNATURE = 0x06054b50;
const ZIP_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_END_BYTES = 22;
const ZIP_DIRECTORY_ENTRY_BYTES = 46;
const ZIP_MAXIMUM_COMMENT = 65_535;
const ZIP_MAXIMUM_ENTRIES = 10_000;

function fileExtension(fileName: string): string {
  return /\.([a-z0-9]+)$/u.exec(fileName.toLowerCase())?.[1] ?? "";
}

/** Programs are refused whatever their name says; a DOS header alone may also start a text. */
function isExecutable(head: Buffer): boolean {
  return (
    EXECUTABLE_MAGIC.has(head.subarray(0, 4).toString("hex")) ||
    (head.toString("latin1", 0, 2) === "MZ" && head.subarray(0, 64).includes(0))
  );
}

function findZipEnd(tail: Buffer): number {
  const lowest = Math.max(0, tail.length - ZIP_END_BYTES - ZIP_MAXIMUM_COMMENT);
  for (let offset = tail.length - ZIP_END_BYTES; offset >= lowest; offset -= 1)
    if (tail.readUInt32LE(offset) === ZIP_END_SIGNATURE) return offset;
  return -1;
}

function readDirectoryNames(
  tail: Buffer,
  directory: { readonly start: number; readonly end: number },
  entries: number,
): string[] | null {
  const names: string[] = [];
  let cursor = directory.start;
  for (let index = 0; index < entries; index += 1) {
    if (
      cursor + ZIP_DIRECTORY_ENTRY_BYTES > directory.end ||
      tail.readUInt32LE(cursor) !== ZIP_DIRECTORY_SIGNATURE
    )
      return null;
    const nameEnd =
      cursor + ZIP_DIRECTORY_ENTRY_BYTES + tail.readUInt16LE(cursor + 28);
    names.push(
      tail.toString("utf8", cursor + ZIP_DIRECTORY_ENTRY_BYTES, nameEnd),
    );
    cursor =
      nameEnd + tail.readUInt16LE(cursor + 30) + tail.readUInt16LE(cursor + 32);
  }
  return names;
}

/**
 * Reads the entry names from the central directory at the end of a ZIP file.
 *
 * @returns The names, or `null` when the directory is missing, damaged, uses
 * ZIP64 or does not lie within the kept tail of the file.
 */
function readZipEntryNames(facts: ChatFileFacts): string[] | null {
  const { tail, size } = facts;
  const end = tail.length < ZIP_END_BYTES ? -1 : findZipEnd(tail);
  if (end < 0) return null;
  const entries = tail.readUInt16LE(end + 10);
  const start = tail.readUInt32LE(end + 16) - (size - tail.length);
  if (
    entries === 0xffff ||
    entries > ZIP_MAXIMUM_ENTRIES ||
    start < 0 ||
    start + tail.readUInt32LE(end + 12) > end
  )
    return null;
  return readDirectoryNames(tail, { start, end }, entries);
}

function isOfficeFile(facts: ChatFileFacts, part: string): boolean {
  if (facts.head.subarray(0, 4).toString("hex") !== ZIP_LOCAL_HEADER)
    return false;
  const names = readZipEntryNames(facts);
  return (
    names !== null &&
    names.includes("[Content_Types].xml") &&
    names.includes(part) &&
    !names.some((name) => EXECUTABLE_PART.test(name))
  );
}

function detectType(
  extension: string,
  facts: ChatFileFacts,
  isSafeSvg: (markup: Buffer) => boolean,
): ChatFileType | null {
  const image = IMAGE_TYPES.get(extension);
  if (image !== undefined)
    return detectFileType(facts.head).contentType === image
      ? { contentType: image, isText: false }
      : null;
  if (extension === "svg")
    return facts.markup !== null && facts.isText && isSafeSvg(facts.markup)
      ? { contentType: "image/svg+xml", isText: false }
      : null;
  if (extension === "pdf")
    return facts.head.toString("latin1", 0, 5) === "%PDF-"
      ? { contentType: "application/pdf", isText: false }
      : null;
  const office = OFFICE_TYPES.get(extension);
  if (office !== undefined)
    return isOfficeFile(facts, office.part)
      ? { contentType: office.contentType, isText: false }
      : null;
  const text =
    TEXT_TYPES.get(extension) ??
    (SOURCE_EXTENSIONS.has(extension) ? "text/plain" : undefined);
  return text !== undefined && facts.isText
    ? { contentType: text, isText: true }
    : null;
}

/**
 * Decides the type of an uploaded file from its content (T6.12.4).
 *
 * @param fileName - The cleaned name; its extension names the expected kind.
 * @param facts - What the content revealed while it was stored.
 * @param isSafeSvg - Tells whether SVG markup is free of scripts and external references.
 * @returns The accepted type.
 * @throws {ChatError} `fileTypeNotAllowed` for programs, archives with
 * executable content, unknown kinds and content that does not match its name.
 */
export function classifyChatFile(
  fileName: string,
  facts: ChatFileFacts,
  isSafeSvg: (markup: Buffer) => boolean,
): ChatFileType {
  if (isExecutable(facts.head)) throw new ChatError("fileTypeNotAllowed");
  const type = detectType(fileExtension(fileName), facts, isSafeSvg);
  if (type === null) throw new ChatError("fileTypeNotAllowed");
  return type;
}
