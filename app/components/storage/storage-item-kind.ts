/** The kinds of entries the Storage list shows with an icon of their own (PAGE-272). */
export type StorageItemKind =
  | "folder"
  | "document"
  | "spreadsheet"
  | "presentation"
  | "pdf"
  | "image"
  | "video"
  | "audio"
  | "archive"
  | "code"
  | "text"
  | "form"
  | "drawing"
  | "shortcut"
  | "file";

/** The MIME types Drive reports when it knows nothing about the content. */
const GENERIC_MIME_TYPES: readonly string[] = [
  "",
  "application/octet-stream",
  "application/binary",
  "binary/octet-stream",
  "application/unknown",
];

/** Exact MIME types; checked before the prefixes. */
const KINDS_BY_MIME: Readonly<Record<string, StorageItemKind>> = {
  "application/vnd.google-apps.folder": "folder",
  "application/vnd.google-apps.document": "document",
  "application/vnd.google-apps.spreadsheet": "spreadsheet",
  "application/vnd.google-apps.presentation": "presentation",
  "application/vnd.google-apps.form": "form",
  "application/vnd.google-apps.drawing": "drawing",
  "application/vnd.google-apps.shortcut": "shortcut",
  "application/pdf": "pdf",
  "application/msword": "document",
  "application/rtf": "document",
  "application/vnd.oasis.opendocument.text": "document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "document",
  "application/vnd.ms-excel": "spreadsheet",
  "application/vnd.oasis.opendocument.spreadsheet": "spreadsheet",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    "spreadsheet",
  "text/csv": "spreadsheet",
  "application/vnd.ms-powerpoint": "presentation",
  "application/vnd.oasis.opendocument.presentation": "presentation",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "presentation",
  "application/zip": "archive",
  "application/gzip": "archive",
  "application/x-7z-compressed": "archive",
  "application/x-bzip2": "archive",
  "application/x-rar-compressed": "archive",
  "application/vnd.rar": "archive",
  "application/x-tar": "archive",
  "application/x-zip-compressed": "archive",
  "application/json": "code",
  "application/javascript": "code",
  "application/typescript": "code",
  "application/x-sh": "code",
  "application/x-httpd-php": "code",
  "application/xml": "code",
  "application/sql": "code",
  "application/x-yaml": "code",
  "text/html": "code",
  "text/css": "code",
  "text/javascript": "code",
  "text/xml": "code",
  "text/x-python": "code",
  "text/x-shellscript": "code",
  "text/markdown": "text",
};

/** Beginnings of MIME types; the first match wins. */
const KINDS_BY_MIME_PREFIX: readonly (readonly [string, StorageItemKind])[] = [
  ["image/", "image"],
  ["video/", "video"],
  ["audio/", "audio"],
  ["text/", "text"],
];

/** File endings, for files Drive reports only as generic bytes. */
const KINDS_BY_EXTENSION: Readonly<Record<string, StorageItemKind>> = {
  doc: "document",
  docx: "document",
  odt: "document",
  rtf: "document",
  pages: "document",
  xls: "spreadsheet",
  xlsx: "spreadsheet",
  ods: "spreadsheet",
  csv: "spreadsheet",
  numbers: "spreadsheet",
  ppt: "presentation",
  pptx: "presentation",
  odp: "presentation",
  key: "presentation",
  pdf: "pdf",
  jpg: "image",
  jpeg: "image",
  png: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  heic: "image",
  bmp: "image",
  tif: "image",
  tiff: "image",
  mp4: "video",
  mov: "video",
  mkv: "video",
  avi: "video",
  webm: "video",
  m4v: "video",
  mp3: "audio",
  wav: "audio",
  flac: "audio",
  ogg: "audio",
  m4a: "audio",
  aac: "audio",
  zip: "archive",
  rar: "archive",
  "7z": "archive",
  tar: "archive",
  gz: "archive",
  tgz: "archive",
  bz2: "archive",
  xz: "archive",
  js: "code",
  jsx: "code",
  ts: "code",
  tsx: "code",
  json: "code",
  py: "code",
  rb: "code",
  go: "code",
  rs: "code",
  java: "code",
  kt: "code",
  c: "code",
  h: "code",
  cpp: "code",
  cs: "code",
  php: "code",
  sh: "code",
  sql: "code",
  html: "code",
  css: "code",
  xml: "code",
  yml: "code",
  yaml: "code",
  txt: "text",
  md: "text",
  log: "text",
};

function kindOfExtension(name: string): StorageItemKind {
  const dot = name.lastIndexOf(".");

  if (dot <= 0 || dot === name.length - 1) {
    return "file";
  }

  const extension = name.slice(dot + 1).toLowerCase();

  return Object.hasOwn(KINDS_BY_EXTENSION, extension)
    ? (KINDS_BY_EXTENSION[extension] ?? "file")
    : "file";
}

/**
 * Names the kind of an entry for its icon.
 *
 * @param entry - Whether it is a folder, its MIME type and its name.
 * @returns The kind by the MIME type; when Drive reports only generic bytes,
 * by the file ending; otherwise `file`.
 */
export function storageItemKind(entry: {
  readonly isFolder: boolean;
  readonly mimeType: string;
  readonly name: string;
}): StorageItemKind {
  if (entry.isFolder) {
    return "folder";
  }

  const mimeType = entry.mimeType.toLowerCase().split(";")[0]?.trim() ?? "";

  if (GENERIC_MIME_TYPES.includes(mimeType)) {
    return kindOfExtension(entry.name);
  }

  if (Object.hasOwn(KINDS_BY_MIME, mimeType)) {
    return KINDS_BY_MIME[mimeType] ?? "file";
  }

  return (
    KINDS_BY_MIME_PREFIX.find(([prefix]) => mimeType.startsWith(prefix))?.[1] ??
    "file"
  );
}
