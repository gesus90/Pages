import { expect, it, vi } from "vitest";

import {
  WikiAccessDeniedError,
  WikiPageNotFoundError,
  WikiValidationError,
} from "@/backend/error/WikiErrors";
import { FileTooLargeError } from "@/backend/storage/WikiFileStore";

import { WikiAttachmentService } from "./WikiAttachmentService";

import type { Mock } from "vitest";
import type { UploadedFile } from "./WikiAttachmentService";

import type { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import type { WikiFileStore } from "@/backend/storage/WikiFileStore";
import type { User } from "@/definition/User";
import type { WikiAccess } from "./WikiAccess";
import type { WikiSettingsService } from "./WikiSettingsService";

vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

const actor: User = {
  displayName: "Ann",
  id: "u1",
  isActive: true,
  mustChangePassword: false,
  role: "employee",
  username: "ann",
};
const limits = { fileLimitBytes: 10, mediaLimitBytes: 100 };

interface Options {
  readonly canWrite?: boolean;
  readonly isAdmin?: boolean;
  readonly page?: object | null;
  readonly stored?: object | null;
}

interface Context {
  readonly files: Record<string, Mock>;
  readonly repository: {
    readonly attachments: Record<string, Mock>;
    readonly pages: Record<string, Mock>;
    readonly writes: Record<string, Mock>;
  };
  readonly service: WikiAttachmentService;
}

function setup(options: Options = {}): Context {
  const page =
    options.page === undefined
      ? { id: "p", ownerId: "other", scope: "project" }
      : options.page;
  const repository = {
    attachments: {
      delete: vi.fn(async () => {}),
      find: vi.fn(async () => options.stored ?? null),
      insert: vi.fn(async () => ({ createdAt: "now", id: "a1" })),
      listByPage: vi.fn(async () => [storedAttachment()]),
      listStorageNames: vi.fn(async () => ["s1"]),
    },
    pages: { findVisible: vi.fn(async () => page) },
    writes: { setCover: vi.fn(async () => {}) },
  };
  const files = {
    open: vi.fn(() => "stream"),
    remove: vi.fn(async () => {}),
    sweep: vi.fn(async () => 2),
    write: vi.fn(),
  };
  const access = {
    resolve: vi.fn(async () => ({
      canManageProjects: false,
      canWrite: options.canWrite ?? true,
      scope: { isAdmin: options.isAdmin ?? false, userId: "u1" },
    })),
  };
  const settings = { get: vi.fn(async () => limits) };
  const service = new WikiAttachmentService(
    repository as unknown as WikiRepository,
    access as unknown as WikiAccess,
    settings as unknown as WikiSettingsService,
    files as unknown as WikiFileStore,
  );

  return { files, repository, service };
}

function storedAttachment(uploadedBy = "u1"): object {
  return {
    contentType: "image/png",
    createdAt: "now",
    fileName: "a.png",
    id: "a1",
    kind: "media",
    pageId: "p",
    size: 5,
    storageName: "s1",
    uploadedBy,
    uploadedByName: "Ann",
  };
}

function upload(
  contentLength: number | null = null,
  fileName = "a.png",
): UploadedFile {
  return { body: (async function* () {})(), contentLength, fileName };
}

function writeResult(setupResult: Context, head: number[], size: number): void {
  setupResult.files.write.mockImplementation(
    async (body: unknown, options: { limitFor: (head: Buffer) => number }) => {
      options.limitFor(Buffer.from(head));

      return { checksum: "c", size, storageName: "s1" };
    },
  );
}

it("stores an image upload with its detected type", async () => {
  const context = setup();

  writeResult(context, [0xff, 0xd8, 0xff], 5);

  await expect(
    context.service.upload(actor, "p", upload(5)),
  ).resolves.toMatchObject({
    contentType: "image/jpeg",
    id: "a1",
    isEmbeddable: true,
    kind: "media",
    uploadedByName: "Ann",
  });
});

it("uses the file limit for unknown content", async () => {
  const context = setup();
  let applied = 0;

  context.files.write.mockImplementation(
    async (body: unknown, options: { limitFor: (head: Buffer) => number }) => {
      applied = options.limitFor(Buffer.from([1, 2, 3]));

      return { checksum: "c", size: 3, storageName: "s1" };
    },
  );

  await context.service.upload(actor, "p", upload());

  expect(applied).toBe(10);
});

it("rejects uploads without write access", async () => {
  const { service } = setup({ canWrite: false });

  await expect(service.upload(actor, "p", upload())).rejects.toBeInstanceOf(
    WikiAccessDeniedError,
  );
});

it("rejects too long names and announced sizes", async () => {
  const { service } = setup();

  await expect(
    service.upload(actor, "p", upload(null, "a".repeat(300))),
  ).rejects.toMatchObject({ code: "fileNameTooLong" });
  await expect(service.upload(actor, "p", upload(101))).rejects.toMatchObject({
    code: "fileTooLarge",
  });
});

it("maps an exceeded stream limit and passes other errors on", async () => {
  const context = setup();

  context.files.write.mockRejectedValueOnce(new FileTooLargeError());
  await expect(
    context.service.upload(actor, "p", upload()),
  ).rejects.toBeInstanceOf(WikiValidationError);

  const failure = new Error("disk");

  context.files.write.mockRejectedValueOnce(failure);
  await expect(context.service.upload(actor, "p", upload())).rejects.toBe(
    failure,
  );
});

it("removes and rejects an empty file", async () => {
  const context = setup();

  writeResult(context, [1], 0);

  await expect(
    context.service.upload(actor, "p", upload()),
  ).rejects.toMatchObject({ code: "fileEmpty" });
  expect(context.files.remove).toHaveBeenCalledWith(["s1"]);
});

it("removes the file when the record cannot be stored", async () => {
  const context = setup();
  const failure = new Error("insert");

  writeResult(context, [1], 3);
  context.repository.attachments.insert.mockRejectedValueOnce(failure);

  await expect(context.service.upload(actor, "p", upload())).rejects.toBe(
    failure,
  );
  expect(context.files.remove).toHaveBeenCalledWith(["s1"]);
});

it("lists the attachments of a visible page", async () => {
  const { service } = setup();

  await expect(service.list(actor, "p")).resolves.toMatchObject([
    { id: "a1", isEmbeddable: true },
  ]);
});

it("opens an attachment and hides missing ones", async () => {
  const found = setup({ stored: storedAttachment() });

  await expect(found.service.open(actor, "a1")).resolves.toMatchObject({
    attachment: { id: "a1" },
    stream: "stream",
  });
  await expect(setup().service.open(actor, "a1")).rejects.toBeInstanceOf(
    WikiPageNotFoundError,
  );
});

it("lets the uploader remove an attachment and its cover", async () => {
  const context = setup({
    page: {
      cover: { attachmentId: "a1", kind: "attachment" },
      id: "p",
      ownerId: "other",
      scope: "private",
    },
    stored: storedAttachment(),
  });

  await context.service.remove(actor, "a1");

  expect(context.repository.attachments.delete).toHaveBeenCalledWith("a1");
  expect(context.repository.writes.setCover).toHaveBeenCalledWith("p", null);
  expect(context.files.remove).toHaveBeenCalledWith(["s1"]);
});

it("keeps the cover of another image and of another kind", async () => {
  for (const cover of [
    null,
    { kind: "color" },
    { attachmentId: "other", kind: "attachment" },
  ]) {
    const context = setup({
      page: { cover, id: "p", ownerId: "u1", scope: "project" },
      stored: storedAttachment("x"),
    });

    await context.service.remove(actor, "a1");

    expect(context.repository.writes.setCover).not.toHaveBeenCalled();
  }
});

it("refuses removal by others and hides missing attachments", async () => {
  const context = setup({
    page: { id: "p", ownerId: "other", scope: "project" },
    stored: storedAttachment("x"),
  });

  await expect(context.service.remove(actor, "a1")).rejects.toBeInstanceOf(
    WikiAccessDeniedError,
  );
  await expect(setup().service.remove(actor, "a1")).rejects.toBeInstanceOf(
    WikiPageNotFoundError,
  );
});

it("removes stored files and sweeps orphans", async () => {
  const { files, service } = setup();

  await service.removeFiles(["x"]);
  expect(files.remove).toHaveBeenCalledWith(["x"]);

  await expect(service.sweep()).resolves.toBe(2);
  expect(files.sweep).toHaveBeenCalledWith(new Set(["s1"]), 60 * 60 * 1000);
});
