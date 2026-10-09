import { existsSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkItemAttachmentRepository } from "@/backend/database/repositories/task/WorkItemAttachmentRepository";
import {
  WorkItemAccessDeniedError,
  WorkItemNotFoundError,
} from "@/backend/error/WorkItemErrors";
import { TaskAttachmentService } from "@/backend/service/task/TaskAttachmentService";
import { isEmbeddableType } from "@/backend/service/wiki/WikiFileTypes";
import { WikiFileStore } from "@/backend/storage/WikiFileStore";

import { useMigratedDatabase } from "../helpers/test-database";
import { createUser, createWorkItem } from "../helpers/factories";

import type { TicketAccess } from "@/backend/service/task/TaskAttachmentService";
import type { WorkItemDetail } from "@/definition/Task";

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(100, 1),
]);

function bytes(...chunks: Buffer[]): AsyncIterable<Uint8Array> {
  return Readable.from(chunks);
}

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

const actor = createUser({ displayName: "Ada", id: "user-1" });

describe("ticket attachments", () => {
  const getDatabase = useMigratedDatabase();
  let directory: string;
  let canWrite: boolean;
  let ticket: Pick<WorkItemDetail, "id" | "archivedAt">;
  let tickets: TicketAccess;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "pages-ticket-files-"));
    canWrite = true;
    ticket = { archivedAt: null, id: "ticket-1" };
    tickets = {
      actionPermissions: vi.fn(async () => ({ canDelete: false, canWrite })),
      getById: vi.fn(async (_actor, id: string) => {
        if (id !== ticket.id) {
          throw new WorkItemNotFoundError();
        }

        return createWorkItem(ticket);
      }),
    };
  });

  afterEach(async () => {
    await rm(directory, { force: true, recursive: true });
  });

  function createService(
    limits = { fileLimitBytes: 1_000, mediaLimitBytes: 500 },
  ): TaskAttachmentService {
    return new TaskAttachmentService(
      new WorkItemAttachmentRepository(getDatabase()),
      tickets,
      { getSettings: async () => limits },
      new WikiFileStore(directory),
    );
  }

  it("stores, lists, serves and removes the files of a ticket", async () => {
    const service = createService();
    const image = await service.upload(actor, "ticket-1", {
      body: bytes(PNG),
      contentLength: PNG.length,
      fileName: "../Plan:1.png",
    });
    const text = await service.upload(actor, "ticket-1", {
      body: bytes(Buffer.from("notes")),
      contentLength: null,
      fileName: "notes.txt",
    });

    expect(image).toMatchObject({
      contentType: "image/png",
      fileName: "Plan_1.png",
      isEmbeddable: true,
      kind: "media",
      size: PNG.length,
      uploadedByName: "Ada",
      workItemId: "ticket-1",
    });
    expect(text).toMatchObject({ isEmbeddable: false, kind: "file" });

    const listed = await service.list(actor, "ticket-1");

    expect(listed.map((entry) => entry.id).sort()).toEqual(
      [image.id, text.id].sort(),
    );

    const opened = await service.open(actor, image.id);

    expect(opened.attachment.fileName).toBe("Plan_1.png");
    expect(await readAll(opened.stream)).toEqual(PNG);

    await service.remove(actor, image.id);

    expect((await service.list(actor, "ticket-1")).map((e) => e.id)).toEqual([
      text.id,
    ]);
    expect(readdirSync(directory)).toHaveLength(1);
  });

  it("refuses files that are empty, too large or badly named", async () => {
    const service = createService();

    await expect(
      service.upload(actor, "ticket-1", {
        body: bytes(),
        contentLength: null,
        fileName: "empty.txt",
      }),
    ).rejects.toMatchObject({ code: "attachmentFileEmpty" });
    await expect(
      service.upload(actor, "ticket-1", {
        body: bytes(Buffer.alloc(10)),
        contentLength: 5_000,
        fileName: "big.bin",
      }),
    ).rejects.toMatchObject({ code: "attachmentTooLarge" });
    await expect(
      service.upload(actor, "ticket-1", {
        body: bytes(PNG, Buffer.alloc(600, 1)),
        contentLength: null,
        fileName: "big.png",
      }),
    ).rejects.toMatchObject({ code: "attachmentTooLarge" });
    await expect(
      service.upload(actor, "ticket-1", {
        body: bytes(Buffer.from("x")),
        contentLength: null,
        fileName: `${"n".repeat(256)}.txt`,
      }),
    ).rejects.toMatchObject({ code: "attachmentFileNameTooLong" });
    expect(readdirSync(directory)).toEqual([]);
  });

  it("checks sight and the right to change the ticket", async () => {
    const service = createService();
    const stored = await service.upload(actor, "ticket-1", {
      body: bytes(Buffer.from("plan")),
      contentLength: null,
      fileName: "plan.txt",
    });

    await expect(service.list(actor, "ticket-2")).rejects.toBeInstanceOf(
      WorkItemNotFoundError,
    );
    await expect(service.open(actor, "missing")).rejects.toBeInstanceOf(
      WorkItemNotFoundError,
    );
    await expect(service.remove(actor, "missing")).rejects.toBeInstanceOf(
      WorkItemNotFoundError,
    );

    canWrite = false;

    await expect(
      service.upload(actor, "ticket-1", {
        body: bytes(Buffer.from("x")),
        contentLength: null,
        fileName: "x.txt",
      }),
    ).rejects.toBeInstanceOf(WorkItemAccessDeniedError);
    await expect(service.remove(actor, stored.id)).rejects.toBeInstanceOf(
      WorkItemAccessDeniedError,
    );
    await expect(service.open(actor, stored.id)).resolves.toMatchObject({
      attachment: { id: stored.id },
    });

    canWrite = true;
    ticket = { archivedAt: "2026-10-09 06:00:00", id: "ticket-1" };

    await expect(
      service.upload(actor, "ticket-1", {
        body: bytes(Buffer.from("x")),
        contentLength: null,
        fileName: "x.txt",
      }),
    ).rejects.toMatchObject({ code: "ticketArchived" });

    ticket = { archivedAt: null, id: "ticket-2" };

    await expect(service.open(actor, stored.id)).rejects.toBeInstanceOf(
      WorkItemNotFoundError,
    );
  });

  it("removes the stored file when the metadata cannot be written", async () => {
    const service = createService();

    await getDatabase().execute("DROP TABLE work_item_attachments;");

    await expect(
      service.upload(actor, "ticket-1", {
        body: bytes(Buffer.from("plan")),
        contentLength: null,
        fileName: "plan.txt",
      }),
    ).rejects.toThrow();
    expect(readdirSync(directory)).toEqual([]);
  });

  it("passes on other failures of the file store", async () => {
    const service = new TaskAttachmentService(
      new WorkItemAttachmentRepository(getDatabase()),
      tickets,
      {
        getSettings: async () => ({ fileLimitBytes: 10, mediaLimitBytes: 10 }),
      },
      new WikiFileStore(path.join(directory, "blocked")),
    );

    writeFileSync(path.join(directory, "blocked"), "a file, not a directory");

    await expect(
      service.upload(actor, "ticket-1", {
        body: bytes(Buffer.from("x")),
        contentLength: null,
        fileName: "x.txt",
      }),
    ).rejects.toThrow();
  });

  it("removes files of deleted tickets and sweeps old orphans", async () => {
    const service = createService();
    const kept = await service.upload(actor, "ticket-1", {
      body: bytes(Buffer.from("kept")),
      contentLength: null,
      fileName: "kept.txt",
    });
    const orphan = path.join(directory, "orphan");
    const fresh = path.join(directory, "fresh");
    const repository = new WorkItemAttachmentRepository(getDatabase());

    writeFileSync(orphan, "old");
    writeFileSync(fresh, "new");
    utimesSync(orphan, new Date(0), new Date(0));

    await expect(service.sweep()).resolves.toBe(1);
    expect(existsSync(fresh)).toBe(true);

    const [storageName] = await repository.findStorageNames(["ticket-1"]);

    await expect(repository.findStorageNames([])).resolves.toEqual([]);
    await service.removeFiles([storageName ?? ""]);

    expect(existsSync(path.join(directory, storageName ?? ""))).toBe(false);
    expect(kept.kind).toBe("file");
  });

  it("only embeds raster images", () => {
    expect(isEmbeddableType("image/png", "media")).toBe(true);
    expect(isEmbeddableType("audio/ogg", "media")).toBe(false);
    expect(isEmbeddableType("image/png", "file")).toBe(false);
  });
});
