import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { expect, it, vi } from "vitest";

import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";

import type * as FileSystem from "node:fs";

const boundary = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof FileSystem>()),
  createReadStream: boundary.open,
}));

import { TicketFileStore } from "./TicketFileStore";

it("rejects a file stream that yields text instead of bytes", async () => {
  const root = pagesTempDirectory("ticket-stream-failure-tests");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, "case-"));
  const ticketId = "12345678-1234-1234-1234-123456789abc";
  const attachmentId = "abcdefab-1234-1234-1234-123456789abc";
  const storageName = `assets/${ticketId}/${attachmentId}.bin`;
  const file = path.join(directory, storageName);
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "content");
    boundary.open.mockReturnValueOnce(Readable.from(["not bytes"]));
    await expect(
      new TicketFileStore(directory).inspect(storageName),
    ).rejects.toThrow("Invalid file stream.");
    expect(boundary.open).toHaveBeenCalledExactlyOnceWith(file);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
