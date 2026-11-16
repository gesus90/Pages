/**
 * Reads the parts of an Office or OpenDocument file in the browser.
 * Both are ZIP archives; this reader knows exactly what they need: stored and
 * deflated entries of an archive below 4 GB.
 */

const END_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const END_RECORD_BYTES = 22;
const LONGEST_COMMENT_BYTES = 0xffff;
const ENCRYPTED_FLAG = 0x1;
const METHOD_STORED = 0;
const METHOD_DEFLATED = 8;

/** The signature of an OLE compound file: older Office formats and encrypted Office files. */
const COMPOUND_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0];

/** Inflated bytes one part and one whole reading may take, against ZIP bombs. */
export const ZIP_LIMITS = {
  entryBytes: 32 * 1024 * 1024,
  totalBytes: 96 * 1024 * 1024,
} as const;

/** Why a file could not be read as an archive. */
export type ZipFailure = "encrypted" | "unreadable" | "tooLarge";

/** The error of a file that is no readable archive. */
export class ZipReadError extends Error {
  public readonly reason: ZipFailure;

  public constructor(reason: ZipFailure) {
    super(`The archive could not be read: ${reason}.`);
    this.reason = reason;
  }
}

interface ZipEntry {
  readonly method: number;
  readonly isEncrypted: boolean;
  readonly compressedSize: number;
  readonly size: number;
  readonly localOffset: number;
}

/** The parts of an archive by their path, read on demand. */
export interface ZipArchive {
  /** The paths of every part, in the order of the archive. */
  readonly names: readonly string[];
  has(name: string): boolean;
  /** The bytes of a part; `null` for a missing one. */
  read(name: string): Promise<Uint8Array<ArrayBuffer> | null>;
  /** The text of a part as UTF-8; `null` for a missing one. */
  readText(name: string): Promise<string | null>;
}

function findEndRecord(view: DataView): number {
  const lowest = Math.max(
    0,
    view.byteLength - END_RECORD_BYTES - LONGEST_COMMENT_BYTES,
  );
  for (
    let offset = view.byteLength - END_RECORD_BYTES;
    offset >= lowest;
    offset -= 1
  ) {
    if (view.getUint32(offset, true) === END_SIGNATURE) return offset;
  }
  return -1;
}

function readCentralDirectory(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEndRecord(view);
  if (end < 0) throw new ZipReadError("unreadable");
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const entries = new Map<string, ZipEntry>();
  for (let index = 0; index < count; index += 1) {
    if (
      offset + 46 > bytes.length ||
      view.getUint32(offset, true) !== CENTRAL_SIGNATURE
    )
      throw new ZipReadError("unreadable");
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const name = decoder.decode(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
    );
    entries.set(name, {
      method: view.getUint16(offset + 10, true),
      isEncrypted: (view.getUint16(offset + 8, true) & ENCRYPTED_FLAG) !== 0,
      compressedSize: view.getUint32(offset + 20, true),
      size: view.getUint32(offset + 24, true),
      localOffset: view.getUint32(offset + 42, true),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Inflates raw deflate bytes with the browser's own decompression, within a limit. */
async function inflate(
  chunk: Uint8Array,
  limit: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(chunk.slice());
      controller.close();
    },
  });
  const stream = source.pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new ZipReadError("tooLarge");
    }
    parts.push(value);
  }
  const result = new Uint8Array(size);
  let position = 0;
  for (const part of parts) {
    result.set(part, position);
    position += part.byteLength;
  }
  return result;
}

/**
 * Tells whether bytes are an OLE compound file: an older Office format such
 * as `.doc` or an Office file protected with a password.
 *
 * @param bytes - The start of the file.
 */
export function isCompoundFile(bytes: Uint8Array): boolean {
  return COMPOUND_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

/**
 * Opens the bytes of a ZIP archive.
 *
 * @remarks
 * Nothing of the archive is executed; a part is only inflated when it is
 * read. A part above 32 MB or a reading above 96 MB of inflated bytes stops
 * with `tooLarge`, an encrypted part with `encrypted`.
 *
 * @param bytes - The whole file.
 * @throws {ZipReadError} For bytes that are no readable archive.
 */
export function openZip(bytes: Uint8Array): ZipArchive {
  if (isCompoundFile(bytes)) throw new ZipReadError("encrypted");
  const entries = readCentralDirectory(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let inflated = 0;

  async function read(name: string): Promise<Uint8Array<ArrayBuffer> | null> {
    const entry = entries.get(name);
    if (!entry) return null;
    if (entry.isEncrypted) throw new ZipReadError("encrypted");
    const local = entry.localOffset;
    if (
      local + 30 > bytes.length ||
      view.getUint32(local, true) !== LOCAL_SIGNATURE
    )
      throw new ZipReadError("unreadable");
    const start =
      local +
      30 +
      view.getUint16(local + 26, true) +
      view.getUint16(local + 28, true);
    const compressed = bytes.subarray(start, start + entry.compressedSize);
    const limit = Math.min(
      ZIP_LIMITS.entryBytes,
      ZIP_LIMITS.totalBytes - inflated,
    );
    if (entry.size > limit) throw new ZipReadError("tooLarge");
    let content: Uint8Array<ArrayBuffer>;
    if (entry.method === METHOD_STORED) content = compressed.slice();
    else if (entry.method === METHOD_DEFLATED)
      content = await inflate(compressed, limit);
    else throw new ZipReadError("unreadable");
    inflated += content.byteLength;
    return content;
  }

  return {
    names: [...entries.keys()],
    has: (name) => entries.has(name),
    read,
    async readText(name) {
      const content = await read(name);
      return content === null ? null : new TextDecoder().decode(content);
    },
  };
}
