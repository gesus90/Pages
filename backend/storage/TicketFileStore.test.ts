import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { afterEach, beforeEach, expect, it } from "vitest";

import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";

import { collectStream } from "./StreamBytes";
import { isTicketAssetPath, TicketFileStore } from "./TicketFileStore";

const ticketId = "12345678-1234-1234-1234-123456789abc";
const attachmentId = "abcdefab-1234-1234-1234-123456789abc";
const options = { absoluteLimit: 100, limitFor: () => 100 };
let directory = "";

beforeEach(async () => {
  const root = pagesTempDirectory("ticket-store-tests");
  await mkdir(root, { recursive: true });
  directory = await mkdtemp(path.join(root, "case-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

it("writes, inspects, reads and removes a content-typed attachment", async () => {
  const store = new TicketFileStore(directory);
  const content = Buffer.from("%PDF-example");
  const stored = await store.write(
    { ticketId, attachmentId },
    Readable.from([content]),
    options,
  );
  expect(stored.storageName).toBe(`assets/${ticketId}/${attachmentId}.pdf`);
  expect(stored.type.contentType).toBe("application/pdf");
  expect(await store.inspect(stored.storageName)).toEqual({
    size: content.length,
    checksum: createHash("sha256").update(content).digest("hex"),
    type: stored.type,
  });
  expect(await collectStream(store.open(stored.storageName), 100)).toEqual(
    content,
  );
  await store.remove([stored.storageName]);
  await expect(
    readFile(path.join(directory, stored.storageName)),
  ).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readdir(path.join(directory, "assets"))).toEqual([]);
});

it("inspects large attachments using their initial bytes and the complete content", async () => {
  const store = new TicketFileStore(directory);
  const content = Buffer.concat([
    Buffer.from("%PDF-example\n"),
    Buffer.alloc(140_000, 0x61),
    Buffer.from("final bytes"),
  ]);
  const stored = await store.write(
    { ticketId, attachmentId },
    Readable.from([content.subarray(0, 11), content.subarray(11)]),
    { absoluteLimit: content.length, limitFor: () => content.length },
  );
  expect(stored.storageName).toBe(`assets/${ticketId}/${attachmentId}.pdf`);
  expect(await store.inspect(stored.storageName)).toEqual({
    size: content.length,
    checksum: createHash("sha256").update(content).digest("hex"),
    type: stored.type,
  });
  expect(stored.type.contentType).toBe("application/pdf");
});

it("validates identifiers and storage paths and supports legacy reads", async () => {
  const store = new TicketFileStore(directory);
  expect(isTicketAssetPath(`assets/${ticketId}/${attachmentId}.PDF`)).toBe(
    true,
  );
  expect(isTicketAssetPath(`assets/${ticketId}/../file`)).toBe(false);
  await expect(
    store.write(
      { ticketId: "../bad", attachmentId },
      Readable.from([]),
      options,
    ),
  ).rejects.toThrow("Invalid ticket attachment identifier");
  await expect(
    store.write({ ticketId, attachmentId: "bad" }, Readable.from([]), options),
  ).rejects.toThrow("Invalid ticket attachment identifier");
  expect(() => store.open("../bad")).toThrow(
    "Invalid ticket attachment storage path",
  );
  await mkdir(path.join(directory, "ticket-attachments"));
  await writeFile(
    path.join(directory, "ticket-attachments", attachmentId),
    "legacy",
  );
  expect(await collectStream(store.open(attachmentId), 100)).toEqual(
    Buffer.from("legacy"),
  );
  await store.remove([attachmentId]);
  await expect(store.requireFile(attachmentId)).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("rejects symbolic link directories and non-file attachments", async () => {
  const store = new TicketFileStore(directory);
  const assets = path.join(directory, "assets");
  const target = path.join(directory, "target");
  await mkdir(assets);
  await mkdir(target);
  await symlink(target, path.join(assets, ticketId));
  const name = `assets/${ticketId}/${attachmentId}.bin`;
  await expect(store.requireFile(name)).rejects.toThrow(
    "Invalid ticket attachment directory",
  );
  await expect(
    store.write({ ticketId, attachmentId }, Readable.from([]), options),
  ).rejects.toThrow("Invalid ticket attachment directory");
  await rm(path.join(assets, ticketId));
  await mkdir(path.join(assets, ticketId));
  await mkdir(path.join(assets, ticketId, `${attachmentId}.bin`));
  await expect(store.requireFile(name)).rejects.toThrow(
    "Invalid ticket attachment file",
  );
});

it("sweeps only old unknown files in valid ticket directories", async () => {
  const store = new TicketFileStore(directory);
  expect(await store.sweep(new Set(), 10000)).toBe(0);
  const ticketDirectory = path.join(directory, "assets", ticketId);
  await mkdir(ticketDirectory, { recursive: true });
  await mkdir(path.join(directory, "assets", "invalid"));
  await mkdir(path.join(ticketDirectory, "nested"));
  for (const name of ["old", "known", "recent"])
    await writeFile(path.join(ticketDirectory, name), name);
  await utimes(path.join(ticketDirectory, "old"), 1, 1);
  await utimes(path.join(ticketDirectory, "known"), 1, 1);
  expect(await store.sweep(new Set([`assets/${ticketId}/known`]), 10000)).toBe(
    1,
  );
  expect((await readdir(ticketDirectory)).sort()).toEqual([
    "known",
    "nested",
    "recent",
  ]);
});

it("handles already missing ticket directories and propagates invalid sweep roots", async () => {
  const store = new TicketFileStore(directory);
  await expect(
    store.remove([`assets/${ticketId}/${attachmentId}.bin`]),
  ).resolves.toBeUndefined();
  await writeFile(path.join(directory, "assets"), "not a directory");
  await expect(store.sweep(new Set(), 1000)).rejects.toMatchObject({
    code: "ENOTDIR",
  });
  expect(await readFile(path.join(directory, "assets"), "utf8")).toBe(
    "not a directory",
  );
});
