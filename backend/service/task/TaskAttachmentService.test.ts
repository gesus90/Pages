import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  WorkItemAccessDeniedError,
  WorkItemNotFoundError,
  WorkItemValidationError,
} from "@/backend/error/WorkItemErrors";
import { logCaughtError } from "@/backend/logging/Logger";
import { FileTooLargeError } from "@/backend/storage/WikiFileStore";

import { TaskAttachmentService } from "./TaskAttachmentService";

import type { WorkItemAttachmentRepository } from "@/backend/database/repositories/task/WorkItemAttachmentRepository";
import type { UploadedFile } from "@/backend/service/wiki/WikiAttachmentService";
import type { TicketFileStore } from "@/backend/storage/TicketFileStore";
import type { TaskActionPermissions, WorkItemDetail } from "@/definition/Task";
import type { User } from "@/definition/User";

vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

function doubleOf<Type>(value: unknown): Type {
  return value as Type;
}

const actor = doubleOf<User>({ displayName: "Actor", id: "u1" });
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const stored = {
  checksum: "abc",
  contentType: "image/png",
  createdAt: 1,
  fileName: "a.png",
  id: "a1",
  isSearchReleased: true,
  kind: "media",
  size: 8,
  storageName: "assets/t/a1.png",
  uploadedBy: "u1",
  uploadedByName: "Actor",
  workItemId: "w1",
};

interface Facts {
  readonly archivedAt?: number | null;
  readonly canWrite?: boolean;
  readonly found?: object | null;
  readonly head?: Buffer;
  readonly size?: number;
}

function setup(facts: Facts = {}): {
  readonly service: TaskAttachmentService;
  readonly repository: Record<string, ReturnType<typeof vi.fn>>;
  readonly files: Record<string, ReturnType<typeof vi.fn>>;
  readonly tickets: Record<string, ReturnType<typeof vi.fn>>;
} {
  const repository = {
    delete: vi.fn(async () => {}),
    find: vi.fn(async () => (facts.found === undefined ? stored : facts.found)),
    insert: vi.fn(async () => ({ createdAt: 5, id: "a1" })),
    listByWorkItem: vi.fn(async () => [stored]),
    listChangesAfter: vi.fn(async () => [{ position: 1 }]),
    listStorageNames: vi.fn(async () => ["x"]),
    setSearchRelease: vi.fn(async () => {}),
  };
  const files = {
    open: vi.fn(() => "stream"),
    remove: vi.fn(async () => {}),
    requireFile: vi.fn(async () => {}),
    sweep: vi.fn(async () => 2),
    write: vi.fn(
      async (
        ...parameters: [
          unknown,
          unknown,
          { limitFor: (head: Buffer) => number },
        ]
      ) => {
        parameters[2].limitFor(facts.head ?? PNG);

        return {
          checksum: "abc",
          size: facts.size ?? 8,
          storageName: "assets/w1/a1.png",
          type: { contentType: "image/png", kind: "media" },
        };
      },
    ),
  };
  const tickets = {
    actionPermissions: vi.fn(async () =>
      doubleOf<TaskActionPermissions>({ canWrite: facts.canWrite ?? true }),
    ),
    getById: vi.fn(async () =>
      doubleOf<WorkItemDetail>({
        archivedAt: facts.archivedAt ?? null,
        id: "w1",
      }),
    ),
  };
  const limits = {
    getSettings: vi.fn(async () => ({
      fileLimitBytes: 100,
      mediaLimitBytes: 1000,
    })),
  };

  return {
    files,
    repository,
    service: new TaskAttachmentService(
      doubleOf<WorkItemAttachmentRepository>(repository),
      tickets,
      limits,
      doubleOf<TicketFileStore>(files),
    ),
    tickets,
  };
}

function uploadOf(overrides: Partial<UploadedFile> = {}): UploadedFile {
  return doubleOf<UploadedFile>({
    body: (async function* () {})(),
    contentLength: 8,
    fileName: "a.png",
    ...overrides,
  });
}

describe("TaskAttachmentService upload", () => {
  beforeEach(() => {
    vi.mocked(logCaughtError).mockClear();
  });

  it("stores an upload and returns the public attachment", async () => {
    const { repository, service } = setup();
    const revalidate = vi.fn(async () => {});

    const result = await service.upload(actor, "w1", uploadOf(), revalidate);

    expect(result).toMatchObject({
      createdAt: 5,
      fileName: "a.png",
      isSearchReleased: false,
      uploadedByName: "Actor",
      workItemId: "w1",
    });
    expect(repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ checksum: "abc", uploadedBy: "u1" }),
      expect.any(String),
      { requiresActiveTicket: true },
    );
    expect(revalidate).toHaveBeenCalled();
  });

  it("accepts an upload of unannounced length and a non-media file", async () => {
    const { service } = setup({ head: Buffer.from("plain text") });

    await expect(
      service.upload(actor, "w1", uploadOf({ contentLength: null })),
    ).resolves.toMatchObject({ workItemId: "w1" });
  });

  it("rejects a file name that is too long", async () => {
    const { service } = setup();

    await expect(
      service.upload(actor, "w1", uploadOf({ fileName: "n".repeat(500) })),
    ).rejects.toThrow(WorkItemValidationError);
  });

  it("rejects an announced size above every limit", async () => {
    const { files, service } = setup();

    await expect(
      service.upload(actor, "w1", uploadOf({ contentLength: 5000 })),
    ).rejects.toThrow(WorkItemValidationError);
    expect(files.write).not.toHaveBeenCalled();
  });

  it("maps a size overrun while streaming to a validation error", async () => {
    const { files, service } = setup();
    files.write.mockRejectedValue(new FileTooLargeError());

    await expect(service.upload(actor, "w1", uploadOf())).rejects.toThrow(
      WorkItemValidationError,
    );
    expect(logCaughtError).toHaveBeenCalled();
  });

  it("passes other write failures on", async () => {
    const { files, service } = setup();
    files.write.mockRejectedValue(new Error("disk"));

    await expect(service.upload(actor, "w1", uploadOf())).rejects.toThrow(
      "disk",
    );
  });

  it("removes a cut-off upload", async () => {
    const { files, service } = setup({ size: 3 });

    await expect(service.upload(actor, "w1", uploadOf())).rejects.toThrow(
      WorkItemValidationError,
    );
    expect(files.remove).toHaveBeenCalledWith(["assets/w1/a1.png"]);
  });

  it("removes an empty upload", async () => {
    const { files, service } = setup({ size: 0 });

    await expect(
      service.upload(actor, "w1", uploadOf({ contentLength: null })),
    ).rejects.toThrow(WorkItemValidationError);
    expect(files.remove).toHaveBeenCalled();
  });

  it("removes the file when the final check fails", async () => {
    const { files, service } = setup();

    await expect(
      service.upload(actor, "w1", uploadOf(), async () => {
        throw new Error("revoked");
      }),
    ).rejects.toThrow("revoked");
    expect(files.remove).toHaveBeenCalledWith(["assets/w1/a1.png"]);
  });
});

describe("TaskAttachmentService access and reads", () => {
  it("denies writes without permission and on archived tickets", async () => {
    await expect(
      setup({ canWrite: false }).service.authorizeUpload(actor, "w1"),
    ).rejects.toThrow(WorkItemAccessDeniedError);
    await expect(
      setup({ archivedAt: 1 }).service.authorizeUpload(actor, "w1"),
    ).rejects.toThrow(WorkItemValidationError);
    await expect(
      setup().service.authorizeUpload(actor, "w1"),
    ).resolves.toBeUndefined();
  });

  it("lists attachments in public form", async () => {
    const { service } = setup();

    const list = await service.list(actor, "w1");

    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "a1", isEmbeddable: true });
    expect(list[0]).not.toHaveProperty("storageName");
  });

  it("opens an attachment and its stream", async () => {
    const { service } = setup();

    await expect(service.open(actor, "a1")).resolves.toMatchObject({
      attachment: { id: "a1" },
      stream: "stream",
    });
  });

  it("hides a missing attachment and a missing file", async () => {
    await expect(
      setup({ found: null }).service.open(actor, "a1"),
    ).rejects.toThrow(WorkItemNotFoundError);
    const { files, service } = setup();
    files.requireFile.mockRejectedValue(new Error("gone"));

    await expect(service.open(actor, "a1")).rejects.toThrow(
      WorkItemNotFoundError,
    );
  });

  it("opens stored bytes for server-side readers", async () => {
    await expect(setup().service.openStored("a1")).resolves.toMatchObject({
      stream: "stream",
    });
    await expect(
      setup({ found: null }).service.openStored("a1"),
    ).resolves.toBeNull();
    const { files, service } = setup();
    files.requireFile.mockRejectedValue(new Error("gone"));

    await expect(service.openStored("a1")).resolves.toBeNull();
  });
});

describe("TaskAttachmentService changes", () => {
  it("removes an attachment and its file", async () => {
    const { files, repository, service } = setup();

    await service.remove(actor, "a1");

    expect(repository.delete).toHaveBeenCalledWith("a1");
    expect(files.remove).toHaveBeenCalledWith(["assets/t/a1.png"]);
  });

  it("sets and withdraws the search release", async () => {
    const { repository, service } = setup();

    await service.setSearchRelease(actor, "a1", true);
    await service.setSearchRelease(actor, "a1", false);

    expect(repository.setSearchRelease).toHaveBeenNthCalledWith(1, "a1", "u1");
    expect(repository.setSearchRelease).toHaveBeenNthCalledWith(2, "a1", null);
  });

  it("removes files and sweeps unreferenced ones", async () => {
    const { files, service } = setup();

    await service.removeFiles(["n"]);

    expect(files.remove).toHaveBeenCalledWith(["n"]);
    await expect(service.sweep()).resolves.toBe(2);
    expect(files.sweep).toHaveBeenCalledWith(new Set(["x"]), 3_600_000);
  });

  it("reads asset changes within valid bounds", async () => {
    const { repository, service } = setup();

    await expect(service.listAssetChanges(0)).resolves.toHaveLength(1);
    expect(repository.listChangesAfter).toHaveBeenCalledWith(0, 500);
    await service.listAssetChanges(4, 10);
    expect(repository.listChangesAfter).toHaveBeenCalledWith(4, 10);
  });

  it("rejects invalid positions and limits", async () => {
    const { service } = setup();

    await expect(service.listAssetChanges(-1)).rejects.toThrow(RangeError);
    await expect(service.listAssetChanges(0.5)).rejects.toThrow(RangeError);
    await expect(service.listAssetChanges(0, 0)).rejects.toThrow(RangeError);
    await expect(service.listAssetChanges(0, 501)).rejects.toThrow(RangeError);
    await expect(service.listAssetChanges(0, 1.5)).rejects.toThrow(RangeError);
  });
});
