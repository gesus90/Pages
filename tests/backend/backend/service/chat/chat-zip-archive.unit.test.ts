import { deflateRawSync } from "node:zlib";

import { expect, it } from "vitest";

import { ChatZipArchive } from "@/backend/service/chat/ChatZipArchive";

function archive(
  content: Buffer,
  options: { method?: number; flags?: number } = {},
): Buffer {
  const name = Buffer.from("file.txt");
  const method = options.method ?? 0;
  const encoded = method === 8 ? deflateRawSync(content) : content;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(name.length, 26);
  const directory = Buffer.alloc(46);
  directory.writeUInt32LE(0x02014b50, 0);
  directory.writeUInt16LE(options.flags ?? 0, 8);
  directory.writeUInt16LE(method, 10);
  directory.writeUInt32LE(encoded.length, 20);
  directory.writeUInt32LE(content.length, 24);
  directory.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(local.length + name.length + encoded.length, 16);
  return Buffer.concat([local, name, encoded, directory, name, end]);
}

it("reads stored and compressed entries without extracting paths", () => {
  for (const method of [0, 8]) {
    const zip = new ChatZipArchive(archive(Buffer.from("hello"), { method }), {
      entryBytes: 100,
      totalBytes: 100,
    });
    expect(zip.names()).toEqual(["file.txt"]);
    expect(zip.text("file.txt")).toBe("hello");
    expect(zip.bytes("missing")).toBeNull();
  }
});

it("refuses encrypted, damaged and oversized archives", () => {
  expect(
    () =>
      new ChatZipArchive(Buffer.from("broken"), {
        entryBytes: 10,
        totalBytes: 10,
      }),
  ).toThrow();
  const encrypted = new ChatZipArchive(
    archive(Buffer.from("hello"), { flags: 1 }),
    { entryBytes: 10, totalBytes: 10 },
  );
  expect(() => encrypted.bytes("file.txt")).toThrow("encrypted");
  const large = new ChatZipArchive(archive(Buffer.from("hello")), {
    entryBytes: 4,
    totalBytes: 10,
  });
  expect(() => large.bytes("file.txt")).toThrow("tooLarge");
  const total = new ChatZipArchive(archive(Buffer.from("hello")), {
    entryBytes: 10,
    totalBytes: 5,
  });
  expect(total.text("file.txt")).toBe("hello");
  expect(() => total.text("file.txt")).toThrow("tooLarge");
});
