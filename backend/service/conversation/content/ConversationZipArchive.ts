import { crc32 } from "node:zlib";

/** One file of a ZIP archive, opened when its turn comes. */
export interface ConversationArchiveEntry {
  /** The name inside the archive; duplicates are numbered by {@link archiveNames}. */
  readonly name: string;
  readonly sizeBytes: number;
  open(): AsyncIterable<Uint8Array>;
}

/** An archive beyond the 4 GB of a ZIP without its 64-bit extension. */
export class ZipArchiveTooLargeError extends Error {
  public constructor() {
    super("The archive exceeds 4 GB.");
    this.name = "ZipArchiveTooLargeError";
  }
}

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const ZIP_VERSION = 20;
/** Bit 11: the names are UTF-8. */
const UTF8_FLAG = 0x0800;
const LOCAL_HEADER_BYTES = 30;
const CENTRAL_HEADER_BYTES = 46;
const END_BYTES = 22;
const MAXIMUM_OFFSET = 0xffffffff;

interface WrittenEntry {
  readonly name: Buffer;
  readonly crc: number;
  readonly size: number;
  readonly offset: number;
}

/** The date and time of MS-DOS, as ZIP stores them, in local time. */
function dosDateTime(moment: Date): { time: number; date: number } {
  const year = Math.max(moment.getFullYear(), 1980);
  return {
    time:
      (moment.getHours() << 11) |
      (moment.getMinutes() << 5) |
      Math.floor(moment.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((moment.getMonth() + 1) << 5) | moment.getDate(),
  };
}

function localHeader(
  entry: Omit<WrittenEntry, "offset">,
  stamp: { time: number; date: number },
): Buffer {
  const header = Buffer.alloc(LOCAL_HEADER_BYTES);
  header.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0);
  header.writeUInt16LE(ZIP_VERSION, 4);
  header.writeUInt16LE(UTF8_FLAG, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(stamp.time, 10);
  header.writeUInt16LE(stamp.date, 12);
  header.writeUInt32LE(entry.crc, 14);
  header.writeUInt32LE(entry.size, 18);
  header.writeUInt32LE(entry.size, 22);
  header.writeUInt16LE(entry.name.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, entry.name]);
}

function centralHeader(
  entry: WrittenEntry,
  stamp: { time: number; date: number },
): Buffer {
  const header = Buffer.alloc(CENTRAL_HEADER_BYTES);
  header.writeUInt32LE(CENTRAL_HEADER_SIGNATURE, 0);
  header.writeUInt16LE(ZIP_VERSION, 4);
  header.writeUInt16LE(ZIP_VERSION, 6);
  header.writeUInt16LE(UTF8_FLAG, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(stamp.time, 12);
  header.writeUInt16LE(stamp.date, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.size, 20);
  header.writeUInt32LE(entry.size, 24);
  header.writeUInt16LE(entry.name.length, 28);
  header.writeUInt32LE(entry.offset, 42);
  return Buffer.concat([header, entry.name]);
}

function endRecord(count: number, size: number, offset: number): Buffer {
  const record = Buffer.alloc(END_BYTES);
  record.writeUInt32LE(END_SIGNATURE, 0);
  record.writeUInt16LE(count, 8);
  record.writeUInt16LE(count, 10);
  record.writeUInt32LE(size, 12);
  record.writeUInt32LE(offset, 16);
  return record;
}

/** Reads a file once for its checksum and its real length. */
async function measure(
  entry: ConversationArchiveEntry,
): Promise<{ crc: number; size: number }> {
  let crc = 0;
  let size = 0;
  for await (const chunk of entry.open()) {
    crc = crc32(chunk, crc);
    size += chunk.byteLength;
  }
  return { crc, size };
}

/**
 * Numbers names that occur more than once, before the extension: `a.png`,
 * `a (2).png`, so no file of an archive replaces another when it is unpacked.
 *
 * @param names - The names in their order.
 * @returns The names to store, in the same order.
 */
export function archiveNames(names: readonly string[]): string[] {
  const taken = new Set<string>();
  return names.map((name) => {
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : "";
    let candidate = name;
    for (let number = 2; taken.has(candidate.toLowerCase()); number += 1)
      candidate = `${stem} (${String(number)})${extension}`;
    taken.add(candidate.toLowerCase());
    return candidate;
  });
}

/**
 * The size an archive of the entries will have.
 *
 * @param entries - Names and sizes of the files.
 * @returns The bytes of the archive, so a too large one is refused before it starts.
 */
export function archiveSize(
  entries: readonly Pick<ConversationArchiveEntry, "name" | "sizeBytes">[],
): number {
  let size = END_BYTES;
  for (const name of archiveNames(entries.map((entry) => entry.name))) {
    const length = Buffer.byteLength(name, "utf8");
    size += LOCAL_HEADER_BYTES + CENTRAL_HEADER_BYTES + 2 * length;
  }
  return size + entries.reduce((total, entry) => total + entry.sizeBytes, 0);
}

/**
 * Writes the files as one ZIP archive without compression (PAGE-382).
 *
 * @remarks
 * Images, videos and audio are compressed already, so the files are stored
 * as they are and keep their bytes, names and formats. Each file is read
 * twice: once for its checksum, then for the archive, so nothing of it lies
 * in memory. Names are UTF-8 and numbered where they repeat.
 *
 * @param entries - The files in their order.
 * @param modified - The date the archive gives its files.
 * @throws {ZipArchiveTooLargeError} Beyond 4 GB.
 */
export async function* zipArchive(
  entries: readonly ConversationArchiveEntry[],
  modified: Date,
): AsyncGenerator<Uint8Array> {
  if (archiveSize(entries) > MAXIMUM_OFFSET) throw new ZipArchiveTooLargeError();
  const stamp = dosDateTime(modified);
  const names = archiveNames(entries.map((entry) => entry.name));
  const written: WrittenEntry[] = [];
  let offset = 0;
  for (const [index, entry] of entries.entries()) {
    const { crc, size } = await measure(entry);
    const name = Buffer.from(names[index] ?? entry.name, "utf8");
    const header = localHeader({ name, crc, size }, stamp);
    written.push({ name, crc, size, offset });
    yield header;
    for await (const chunk of entry.open()) yield chunk;
    offset += header.length + size;
    if (offset > MAXIMUM_OFFSET) throw new ZipArchiveTooLargeError();
  }
  const central = Buffer.concat(written.map((entry) => centralHeader(entry, stamp)));
  yield central;
  yield endRecord(written.length, central.length, offset);
}
