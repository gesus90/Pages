/** What the server found out about an uploaded file. */
export interface DetectedFileType {
  /** `media` for images, audio and video, `file` for everything else. */
  readonly kind: "media" | "file";
  /** The type the server sets when it serves the file. */
  readonly contentType: string;
  /** Whether the file may appear inside a page (raster images only). */
  readonly isEmbeddable: boolean;
}

/** Control characters and the characters file systems and headers object to. */
const UNSAFE_CHARACTERS = new RegExp('[\\u0000-\\u001f\\u007f:*?"<>|]', "g");

/** Type served for files whose type is not trusted. */
export const GENERIC_CONTENT_TYPE = "application/octet-stream";

interface Signature {
  readonly contentType: string;
  readonly isEmbeddable: boolean;
  readonly matches: (head: Buffer) => boolean;
}

function startsWith(
  head: Buffer,
  bytes: readonly number[],
  offset = 0,
): boolean {
  return bytes.every((byte, index) => head[offset + index] === byte);
}

function riffIs(head: Buffer, form: string): boolean {
  return (
    startsWith(head, [0x52, 0x49, 0x46, 0x46]) &&
    head.toString("latin1", 8, 12) === form
  );
}

const SIGNATURES: readonly Signature[] = [
  {
    contentType: "image/jpeg",
    isEmbeddable: true,
    matches: (head) => startsWith(head, [0xff, 0xd8, 0xff]),
  },
  {
    contentType: "image/png",
    isEmbeddable: true,
    matches: (head) =>
      startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  {
    contentType: "image/gif",
    isEmbeddable: true,
    matches: (head) =>
      ["GIF87a", "GIF89a"].includes(head.toString("latin1", 0, 6)),
  },
  {
    contentType: "image/webp",
    isEmbeddable: true,
    matches: (head) => riffIs(head, "WEBP"),
  },
  {
    contentType: "audio/wav",
    isEmbeddable: false,
    matches: (head) => riffIs(head, "WAVE"),
  },
  {
    contentType: "video/x-msvideo",
    isEmbeddable: false,
    matches: (head) => riffIs(head, "AVI "),
  },
  {
    contentType: "audio/ogg",
    isEmbeddable: false,
    matches: (head) => head.toString("latin1", 0, 4) === "OggS",
  },
  {
    contentType: "audio/flac",
    isEmbeddable: false,
    matches: (head) => head.toString("latin1", 0, 4) === "fLaC",
  },
  {
    contentType: "audio/mpeg",
    isEmbeddable: false,
    matches: (head) =>
      head.toString("latin1", 0, 3) === "ID3" ||
      (head[0] === 0xff && ((head[1] ?? 0) & 0xe0) === 0xe0),
  },
  {
    contentType: "video/webm",
    isEmbeddable: false,
    matches: (head) => startsWith(head, [0x1a, 0x45, 0xdf, 0xa3]),
  },
  {
    contentType: "video/mp4",
    isEmbeddable: false,
    matches: (head) => head.toString("latin1", 4, 8) === "ftyp",
  },
];

/**
 * Recognizes the type of a file by its content, never by its name.
 *
 * @param head - The first bytes of the file.
 * @returns Its kind and the type to serve. Anything unknown, SVG included,
 * is a plain file that is only ever served as a download.
 */
export function detectFileType(head: Buffer): DetectedFileType {
  const signature = SIGNATURES.find((entry) => entry.matches(head));

  return signature
    ? {
        contentType: signature.contentType,
        isEmbeddable: signature.isEmbeddable,
        kind: "media",
      }
    : { contentType: GENERIC_CONTENT_TYPE, isEmbeddable: false, kind: "file" };
}

/**
 * Tells whether a stored file may appear inside a page or a description.
 *
 * @param contentType - The type found when the file was uploaded.
 * @param kind - The kind found when the file was uploaded.
 * @returns Whether the file is a raster image that browsers show safely.
 */
export function isEmbeddableType(
  contentType: string,
  kind: "media" | "file",
): boolean {
  return (
    kind === "media" &&
    SIGNATURES.some(
      (signature) =>
        signature.isEmbeddable && signature.contentType === contentType,
    )
  );
}

/**
 * Cleans a file name received from a browser.
 *
 * @param name - Name as sent.
 * @returns The name without path parts, control characters and the characters
 * file systems and headers object to; `file` when nothing is left.
 */
export function sanitizeFileName(name: string): string {
  const [base = ""] = name.split(/[\\/]/).slice(-1);
  const cleaned = base
    .normalize("NFC")
    .replace(UNSAFE_CHARACTERS, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");

  return cleaned === "" ? "file" : cleaned;
}
