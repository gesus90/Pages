import { inflateRawSync } from "node:zlib";

/** Signatures and fixed sizes of the ZIP format. */
const END_SIGNATURE = 0x06054b50;
const DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const END_BYTES = 22;
const DIRECTORY_ENTRY_BYTES = 46;
const LOCAL_HEADER_BYTES = 30;
const MAXIMUM_COMMENT = 65_535;
const MAXIMUM_ENTRIES = 10_000;
const STORED = 0;
const DEFLATED = 8;
const ENCRYPTED_FLAG = 0x1;

/** Why an entry or archive could not be read. */
export type ChatZipFailure = "encrypted" | "tooLarge" | "unreadable";

/** Thrown when a ZIP package cannot be read within its bounds. */
export class ChatZipError extends Error {
  public readonly reason: ChatZipFailure;

  public constructor(reason: ChatZipFailure) {
    super(`The ZIP package is ${reason}.`);
    this.name = "ChatZipError";
    this.reason = reason;
  }
}

interface ZipEntry {
  readonly name: string;
  readonly method: number;
  readonly flags: number;
  readonly compressedSize: number;
  readonly size: number;
  readonly offset: number;
}

/** How much a reader of a package may decompress. */
export interface ChatZipLimits {
  /** Bytes one entry may grow to when it is inflated. */
  readonly entryBytes: number;
  /** Bytes all inflated entries of one reading may add up to. */
  readonly totalBytes: number;
}

function findEnd(archive: Buffer): number {
  const lowest = Math.max(0, archive.length - END_BYTES - MAXIMUM_COMMENT);
  for (let offset = archive.length - END_BYTES; offset >= lowest; offset -= 1)
    if (archive.readUInt32LE(offset) === END_SIGNATURE) return offset;
  return -1;
}

function readEntry(archive: Buffer, cursor: number): ZipEntry {
  const nameLength = archive.readUInt16LE(cursor + 28);
  return {
    flags: archive.readUInt16LE(cursor + 8),
    method: archive.readUInt16LE(cursor + 10),
    compressedSize: archive.readUInt32LE(cursor + 20),
    size: archive.readUInt32LE(cursor + 24),
    offset: archive.readUInt32LE(cursor + 42),
    name: archive.toString(
      "utf8",
      cursor + DIRECTORY_ENTRY_BYTES,
      cursor + DIRECTORY_ENTRY_BYTES + nameLength,
    ),
  };
}

function readDirectory(archive: Buffer): ReadonlyMap<string, ZipEntry> {
  const end = archive.length < END_BYTES ? -1 : findEnd(archive);
  if (end < 0) throw new ChatZipError("unreadable");
  const count = archive.readUInt16LE(end + 10);
  const start = archive.readUInt32LE(end + 16);
  if (count === 0xffff || count > MAXIMUM_ENTRIES || start >= end)
    throw new ChatZipError("unreadable");
  const entries = new Map<string, ZipEntry>();
  let cursor = start;
  for (let index = 0; index < count; index += 1) {
    if (
      cursor + DIRECTORY_ENTRY_BYTES > end ||
      archive.readUInt32LE(cursor) !== DIRECTORY_SIGNATURE
    )
      throw new ChatZipError("unreadable");
    const entry = readEntry(archive, cursor);
    entries.set(entry.name, entry);
    cursor +=
      DIRECTORY_ENTRY_BYTES +
      archive.readUInt16LE(cursor + 28) +
      archive.readUInt16LE(cursor + 30) +
      archive.readUInt16LE(cursor + 32);
  }
  return entries;
}

/**
 * Reads named parts of a ZIP package in memory, such as the XML of an Office file.
 *
 * @remarks
 * Only the central directory names the parts; nothing is extracted to the
 * disk, so no name can reach a path. Every part is inflated with a hard limit
 * of its own and against a total, so a compressed bomb ends the reading
 * instead of filling the memory. Encrypted parts and ZIP64 packages are not read.
 */
export class ChatZipArchive {
  private readonly archive: Buffer;
  private readonly entries: ReadonlyMap<string, ZipEntry>;
  private readonly limits: ChatZipLimits;
  private inflated = 0;

  /**
   * Opens a package from its bytes.
   *
   * @throws {ChatZipError} `unreadable` for a damaged directory.
   */
  public constructor(archive: Buffer, limits: ChatZipLimits) {
    this.archive = archive;
    this.limits = limits;
    this.entries = readDirectory(archive);
  }

  /** The names of every part, in the order of the directory. */
  public names(): readonly string[] {
    return [...this.entries.keys()];
  }

  /**
   * Reads one part as UTF-8 text.
   *
   * @returns The text, or `null` when the package has no such part.
   * @throws {ChatZipError} For an encrypted, damaged or too large part.
   */
  public text(name: string): string | null {
    const entry = this.entries.get(name);
    if (entry === undefined) return null;
    if ((entry.flags & ENCRYPTED_FLAG) !== 0)
      throw new ChatZipError("encrypted");
    if (entry.size > this.limits.entryBytes) throw new ChatZipError("tooLarge");
    const content = this.inflate(entry, this.compressedBytes(entry));
    this.inflated += content.length;
    if (this.inflated > this.limits.totalBytes)
      throw new ChatZipError("tooLarge");
    return content.toString("utf8");
  }

  private compressedBytes(entry: ZipEntry): Buffer {
    const header = entry.offset;
    if (
      header + LOCAL_HEADER_BYTES > this.archive.length ||
      this.archive.readUInt32LE(header) !== LOCAL_SIGNATURE
    )
      throw new ChatZipError("unreadable");
    const start =
      header +
      LOCAL_HEADER_BYTES +
      this.archive.readUInt16LE(header + 26) +
      this.archive.readUInt16LE(header + 28);
    const end = start + entry.compressedSize;
    if (end > this.archive.length) throw new ChatZipError("unreadable");
    return this.archive.subarray(start, end);
  }

  private inflate(entry: ZipEntry, compressed: Buffer): Buffer {
    if (entry.method === STORED) return compressed;
    if (entry.method !== DEFLATED) throw new ChatZipError("unreadable");
    try {
      return inflateRawSync(compressed, {
        maxOutputLength: this.limits.entryBytes,
      });
    } catch (caughtError: unknown) {
      throw new ChatZipError(
        caughtError instanceof RangeError ? "tooLarge" : "unreadable",
      );
    }
  }
}
