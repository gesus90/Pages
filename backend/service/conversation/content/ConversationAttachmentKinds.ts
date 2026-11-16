import path from "node:path";

/**
 * How an agent reads an attachment of a chat.
 * @remarks
 * `binary` is every file Pages does not open: archives, programs, legacy
 * Office formats and unknown types. Only name, type, size and checksum of
 * those reach the agent.
 */
export type AgentAttachmentKind =
  | "image"
  | "pdf"
  | "word"
  | "slides"
  | "sheet"
  | "text"
  | "audio"
  | "video"
  | "binary";

/** The German word of a kind, as the agent reads it. */
export const AGENT_ATTACHMENT_KIND_LABELS: Readonly<
  Record<AgentAttachmentKind, string>
> = {
  image: "Bild",
  pdf: "PDF",
  word: "Textdokument",
  slides: "Präsentation",
  sheet: "Tabelle",
  text: "Textdatei",
  audio: "Audio",
  video: "Video",
  binary: "Datei",
};

/** The kinds the search tool takes, by the word the agent writes. */
export const AGENT_ATTACHMENT_KIND_WORDS = {
  bild: "image",
  pdf: "pdf",
  dokument: "word",
  praesentation: "slides",
  tabelle: "sheet",
  text: "text",
  audio: "audio",
  video: "video",
  datei: "binary",
} as const satisfies Record<string, AgentAttachmentKind>;

/** The raster images an agent can see. */
const IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

const WORD_EXTENSIONS: ReadonlySet<string> = new Set([
  ".docx",
  ".docm",
  ".odt",
]);
const SLIDE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".pptx",
  ".pptm",
  ".odp",
]);
const SHEET_EXTENSIONS: ReadonlySet<string> = new Set([
  ".xlsx",
  ".xlsm",
  ".ods",
  ".csv",
  ".tsv",
]);
const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".yaml",
  ".yml",
  ".xml",
  ".svg",
  ".html",
  ".htm",
  ".css",
  ".js",
  ".ts",
  ".tsx",
  ".jsx",
  ".py",
  ".sql",
  ".sh",
  ".log",
  ".diff",
  ".patch",
  ".toml",
  ".ini",
]);

const WORD_TYPES: ReadonlySet<string> = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-word.document.macroenabled.12",
  "application/vnd.oasis.opendocument.text",
]);
const SLIDE_TYPES: ReadonlySet<string> = new Set([
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint.presentation.macroenabled.12",
  "application/vnd.oasis.opendocument.presentation",
]);
const SHEET_TYPES: ReadonlySet<string> = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel.sheet.macroenabled.12",
  "application/vnd.oasis.opendocument.spreadsheet",
  "text/csv",
  "text/tab-separated-values",
]);

/** The lower-case extension of a file name, with its dot. */
export function attachmentExtension(name: string): string {
  return path.extname(name).toLowerCase();
}

function officeKind(
  type: string,
  extension: string,
): AgentAttachmentKind | null {
  if (WORD_TYPES.has(type) || WORD_EXTENSIONS.has(extension)) return "word";
  if (SLIDE_TYPES.has(type) || SLIDE_EXTENSIONS.has(extension)) return "slides";
  if (SHEET_TYPES.has(type) || SHEET_EXTENSIONS.has(extension)) return "sheet";
  return null;
}

/**
 * Decides how an agent reads an attachment, from its type and its name.
 * @param name - The file name; its extension decides where the type is generic.
 * @param mimeType - The stored type.
 * @returns The kind; everything Pages does not read is `binary`.
 */
export function agentAttachmentKind(
  name: string,
  mimeType: string,
): AgentAttachmentKind {
  const type = mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
  const extension = attachmentExtension(name);
  if (IMAGE_TYPES.has(type)) return "image";
  if (type === "application/pdf" || extension === ".pdf") return "pdf";
  const office = officeKind(type, extension);
  if (office) return office;
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("video/")) return "video";
  if (
    type.startsWith("text/") ||
    type === "application/json" ||
    type === "image/svg+xml" ||
    TEXT_EXTENSIONS.has(extension)
  )
    return "text";
  return "binary";
}

/**
 * A size in bytes as people read it.
 * @param bytes - The size.
 * @returns Such as `512 B`, `12,3 KB` or `4,0 MB`.
 */
export function readableSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1).replace(".", ",")} ${units[unit] ?? "GB"}`;
}
