import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { expect, it, vi } from "vitest";

import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";

import type * as FileSystem from "node:fs/promises";

const boundary = vi.hoisted(() => ({ rename: vi.fn(), rmdir: vi.fn() }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof FileSystem>();
  return { ...original, rename: boundary.rename, rmdir: boundary.rmdir };
});

it("propagates a directory removal failure after deleting the attachment", async () => {
  const root = pagesTempDirectory("ticket-removal-failure-tests");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, "case-"));
  const ticketId = "12345678-1234-1234-1234-123456789abc";
  const attachmentId = "abcdefab-1234-1234-1234-123456789abc";
  const storageName = `assets/${ticketId}/${attachmentId}.bin`;
  const ticketDirectory = path.join(directory, "assets", ticketId);
  const failure = Object.assign(new Error("permission denied"), {
    code: "EACCES",
  });
  try {
    await mkdir(ticketDirectory, { recursive: true });
    await writeFile(path.join(directory, storageName), "content");
    boundary.rmdir.mockRejectedValueOnce(failure);
    const store = new TicketFileStore(directory);
    await expect(store.remove([storageName])).rejects.toBe(failure);
    expect(boundary.rmdir).toHaveBeenCalledExactlyOnceWith(ticketDirectory);
    expect(await readdir(ticketDirectory)).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

import { TicketFileStore } from "./TicketFileStore";

it("cleans the staged attachment when publishing its final name fails", async () => {
  const root = pagesTempDirectory("ticket-publish-failure-tests");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, "case-"));
  const ticketId = "12345678-1234-1234-1234-123456789abc";
  const attachmentId = "abcdefab-1234-1234-1234-123456789abc";
  const filesystem =
    await vi.importActual<typeof FileSystem>("node:fs/promises");
  boundary.rename
    .mockImplementationOnce(filesystem.rename)
    .mockRejectedValueOnce(new Error("publish failed"));
  try {
    const store = new TicketFileStore(directory);
    await expect(
      store.write(
        { ticketId, attachmentId },
        Readable.from([Buffer.from("content")]),
        { absoluteLimit: 100, limitFor: () => 100 },
      ),
    ).rejects.toThrow("publish failed");
    expect(boundary.rename).toHaveBeenCalledTimes(2);
    expect(await readdir(path.join(directory, "assets", ticketId))).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
