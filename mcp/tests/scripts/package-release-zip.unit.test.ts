import { crc32, inflateRawSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { createZipArchive } from "../../scripts/package-release.ts";

import type { ArchiveEntry } from "../../scripts/package-release.ts";

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_DIRECTORY_SIGNATURE = 0x06054b50;
const END_OF_DIRECTORY_LENGTH = 22;
const UNIX_REGULAR_FILE_MODE = 0o100644;

/** Fields of one central directory record together with its local file. */
interface ZipRecord {
  readonly name: string;
  readonly content: Buffer;
  readonly versionMadeBy: number;
  readonly versionNeeded: number;
  readonly generalFlags: number;
  readonly method: number;
  readonly modificationTime: number;
  readonly modificationDate: number;
  readonly crc: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly unixMode: number;
  readonly localHeaderMatches: boolean;
}

/** Parsed end record and the records it lists. */
interface ZipListing {
  readonly entryCount: number;
  readonly totalEntryCount: number;
  readonly directoryOffset: number;
  readonly directorySize: number;
  readonly records: readonly ZipRecord[];
}

function readLocalContent(archive: Buffer, localOffset: number): Buffer {
  expect(archive.readUInt32LE(localOffset)).toBe(LOCAL_HEADER_SIGNATURE);
  const nameLength = archive.readUInt16LE(localOffset + 26);
  const extraLength = archive.readUInt16LE(localOffset + 28);
  const compressedSize = archive.readUInt32LE(localOffset + 18);
  const contentStart = localOffset + 30 + nameLength + extraLength;
  return inflateRawSync(
    archive.subarray(contentStart, contentStart + compressedSize),
  );
}

function readRecord(archive: Buffer, centralOffset: number): ZipRecord {
  expect(archive.readUInt32LE(centralOffset)).toBe(CENTRAL_HEADER_SIGNATURE);
  const nameLength = archive.readUInt16LE(centralOffset + 28);
  const localOffset = archive.readUInt32LE(centralOffset + 42);
  const name = archive
    .subarray(centralOffset + 46, centralOffset + 46 + nameLength)
    .toString("utf8");
  const localHeader = archive.subarray(localOffset + 4, localOffset + 30);
  const centralCopy = archive.subarray(centralOffset + 6, centralOffset + 32);
  const localName = archive
    .subarray(localOffset + 30, localOffset + 30 + nameLength)
    .toString("utf8");
  return {
    name,
    content: readLocalContent(archive, localOffset),
    versionMadeBy: archive.readUInt16LE(centralOffset + 4),
    versionNeeded: archive.readUInt16LE(centralOffset + 6),
    generalFlags: archive.readUInt16LE(centralOffset + 8),
    method: archive.readUInt16LE(centralOffset + 10),
    modificationTime: archive.readUInt16LE(centralOffset + 12),
    modificationDate: archive.readUInt16LE(centralOffset + 14),
    crc: archive.readUInt32LE(centralOffset + 16),
    compressedSize: archive.readUInt32LE(centralOffset + 20),
    uncompressedSize: archive.readUInt32LE(centralOffset + 24),
    unixMode: archive.readUInt32LE(centralOffset + 38) >>> 16,
    localHeaderMatches: localHeader.equals(centralCopy) && localName === name,
  };
}

function readZip(archive: Buffer): ZipListing {
  const endOffset = archive.length - END_OF_DIRECTORY_LENGTH;
  expect(archive.readUInt32LE(endOffset)).toBe(END_OF_DIRECTORY_SIGNATURE);
  expect(archive.readUInt16LE(endOffset + 20)).toBe(0);
  const entryCount = archive.readUInt16LE(endOffset + 8);
  const directorySize = archive.readUInt32LE(endOffset + 12);
  const directoryOffset = archive.readUInt32LE(endOffset + 16);
  const records: ZipRecord[] = [];
  let centralOffset = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    const record = readRecord(archive, centralOffset);
    records.push(record);
    centralOffset += 46 + Buffer.byteLength(record.name, "utf8");
  }
  expect(centralOffset).toBe(endOffset);
  return {
    entryCount,
    totalEntryCount: archive.readUInt16LE(endOffset + 10),
    directoryOffset,
    directorySize,
    records,
  };
}

const ENTRIES: readonly ArchiveEntry[] = [
  { name: "pages-mcp-v1.0.0/README.md", content: Buffer.from("# Readme\n") },
  {
    name: "pages-mcp-v1.0.0/examples/clients/über.json",
    content: Buffer.from('{"ä": true}\n'),
  },
  { name: "pages-mcp-v1.0.0/empty.txt", content: Buffer.alloc(0) },
  {
    name: "pages-mcp-v1.0.0/bundle.cjs",
    content: Buffer.from("x".repeat(4096)),
  },
];

describe("createZipArchive structure", () => {
  it("writes an empty archive as a lone end record", () => {
    const archive = createZipArchive([]);

    expect(archive.length).toBe(END_OF_DIRECTORY_LENGTH);
    expect(readZip(archive)).toEqual({
      entryCount: 0,
      totalEntryCount: 0,
      directoryOffset: 0,
      directorySize: 0,
      records: [],
    });
  });

  it("stores every entry sorted by name with its exact content", () => {
    const listing = readZip(createZipArchive(ENTRIES));

    expect(listing.entryCount).toBe(4);
    expect(listing.totalEntryCount).toBe(4);
    expect(listing.records.map((record) => record.name)).toEqual([
      "pages-mcp-v1.0.0/README.md",
      "pages-mcp-v1.0.0/bundle.cjs",
      "pages-mcp-v1.0.0/empty.txt",
      "pages-mcp-v1.0.0/examples/clients/über.json",
    ]);
    for (const record of listing.records) {
      const source = ENTRIES.find((entry) => entry.name === record.name);
      expect(record.content.equals(source?.content ?? Buffer.alloc(1))).toBe(
        true,
      );
    }
  });

  it("writes deflated UTF-8 records with fixed timestamps and file modes", () => {
    const listing = readZip(createZipArchive(ENTRIES));

    for (const record of listing.records) {
      expect(record).toMatchObject({
        versionMadeBy: (3 << 8) | 20,
        versionNeeded: 20,
        generalFlags: 0x0800,
        method: 8,
        modificationTime: 0,
        modificationDate: 0x0021,
        crc: crc32(record.content),
        uncompressedSize: record.content.length,
        unixMode: UNIX_REGULAR_FILE_MODE,
        localHeaderMatches: true,
      });
    }
  });

  it("compresses repetitive content", () => {
    const listing = readZip(createZipArchive(ENTRIES));
    const bundle = listing.records.find((record) =>
      record.name.endsWith("bundle.cjs"),
    );

    expect(bundle?.uncompressedSize).toBe(4096);
    expect(bundle?.compressedSize).toBeLessThan(100);
  });

  it("places the central directory right after the last local record", () => {
    const archive = createZipArchive(ENTRIES);
    const listing = readZip(archive);

    expect(listing.directoryOffset + listing.directorySize).toBe(
      archive.length - END_OF_DIRECTORY_LENGTH,
    );
  });
});

describe("createZipArchive determinism", () => {
  it("produces identical bytes for any input order", () => {
    const reversed = [...ENTRIES].reverse();
    const rotated = [...ENTRIES.slice(2), ...ENTRIES.slice(0, 2)];
    const archive = createZipArchive(ENTRIES);

    expect(createZipArchive(reversed).equals(archive)).toBe(true);
    expect(createZipArchive(rotated).equals(archive)).toBe(true);
  });

  it("does not reorder the caller's entries", () => {
    const entries = [...ENTRIES];

    createZipArchive(entries);

    expect(entries).toEqual(ENTRIES);
  });

  it("changes the bytes when an entry's content changes", () => {
    const changed = ENTRIES.map((entry) =>
      entry.name.endsWith("README.md")
        ? { name: entry.name, content: Buffer.from("# Other\n") }
        : entry,
    );

    expect(createZipArchive(changed).equals(createZipArchive(ENTRIES))).toBe(
      false,
    );
  });
});
