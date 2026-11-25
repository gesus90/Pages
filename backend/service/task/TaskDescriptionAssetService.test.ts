import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  assetFind: vi.fn(),
  assetRemove: vi.fn(),
  attachmentFind: vi.fn(),
  attachmentInsert: vi.fn(),
  auditTickets: vi.fn(),
  filesRemove: vi.fn(),
  filesRequireFile: vi.fn(),
  filesWrite: vi.fn(),
  stagingOpen: vi.fn(),
  stagingRemove: vi.fn(),
}));

vi.mock("@/backend/database/repositories/agents/AgentAssetRepository", () => ({
  AgentAssetRepository: class {
    public find = state.assetFind;
    public remove = state.assetRemove;
  },
}));
vi.mock(
  "@/backend/database/repositories/task/WorkItemAttachmentRepository",
  () => ({
    WorkItemAttachmentRepository: class {
      public find = state.attachmentFind;
      public insert = state.attachmentInsert;
    },
  }),
);
vi.mock(
  "@/backend/database/repositories/task/TicketAssetAuditRepository",
  () => ({
    TicketAssetAuditRepository: class {
      public tickets = state.auditTickets;
    },
  }),
);
vi.mock("@/backend/database/repositories/task/WorkItemWriteRepository", () => ({
  WorkItemWriteRepository: class {},
}));
vi.mock("@/backend/storage/TicketFileStore", () => ({
  TicketFileStore: class {
    public remove = state.filesRemove;
    public requireFile = state.filesRequireFile;
    public write = state.filesWrite;
  },
}));
vi.mock("@/backend/storage/WikiFileStore", () => ({
  WikiFileStore: class {
    public open = state.stagingOpen;
    public remove = state.stagingRemove;
  },
}));

import {
  TaskDescriptionAssetService,
  validateTicketDescriptionSources,
} from "./TaskDescriptionAssetService";

import { ROLE } from "@/definition/Role";

import type { TaskDatabase } from "@/backend/database/repositories/task/TaskDatabase";
import type { User } from "@/definition/User";

const actor: User = {
  displayName: "U",
  id: "u",
  isActive: true,
  mustChangePassword: false,
  role: ROLE.EMPLOYEE,
  username: "u",
};

const asset = {
  checksum: "sum",
  expiresAt: Date.now() + 100_000,
  fileName: "a.png",
  id: "a1",
  size: 5,
  status: "staged",
  storageName: "staged-a1",
  userId: "u",
};

const stored = {
  checksum: "sum",
  size: 5,
  storageName: "stored",
  type: { contentType: "image/png", kind: "image" },
};

interface Harness {
  readonly service: TaskDescriptionAssetService;
  readonly onCommit: ReturnType<typeof vi.fn>;
  readonly onRollback: ReturnType<typeof vi.fn>;
}

function doubleOf<Type extends object>(members: object): Type {
  return members as Type;
}

function setup(effects: boolean = true): Harness {
  const onCommit = vi.fn();
  const onRollback = vi.fn();
  const transaction = {
    execute: vi.fn(async () => {}),
    onCommit: effects ? onCommit : undefined,
    onRollback: effects ? onRollback : undefined,
    query: vi.fn(async () => []),
  };
  const database = doubleOf<TaskDatabase>({
    transaction: vi.fn(
      async (work: (inner: typeof transaction) => Promise<unknown>) =>
        work(transaction),
    ),
  });

  return {
    onCommit,
    onRollback,
    service: new TaskDescriptionAssetService(database, "/dir"),
  };
}

const work = vi.fn(
  async (ignoredRepository: unknown, description: string) => description,
);

function save(
  harness: Harness,
  description: string,
  authorizeTicket?: (ticketId: string) => Promise<void>,
): Promise<string> {
  return harness.service.save(
    { actor, authorizeTicket, description, ticketId: "t" },
    work,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  state.assetFind.mockResolvedValue(asset);
  state.attachmentFind.mockResolvedValue({
    storageName: "file",
    workItemId: "t",
  });
  state.auditTickets.mockResolvedValue([]);
  state.filesRequireFile.mockResolvedValue(undefined);
  state.filesWrite.mockImplementation(
    async (
      ignoredTarget: unknown,
      ignoredSource: unknown,
      options: { readonly limitFor: () => number },
    ) => {
      expect(options.limitFor()).toBe(asset.size);
      return stored;
    },
  );
  state.filesRemove.mockResolvedValue(undefined);
});

it("refuses external images and file links", () => {
  expect(() =>
    validateTicketDescriptionSources("![x](https://example.com/a.png)"),
  ).toThrow(expect.objectContaining({ code: "attachmentUploadRequired" }));
  expect(() => validateTicketDescriptionSources("[x](file:///etc)")).toThrow(
    expect.objectContaining({ code: "attachmentUploadRequired" }),
  );
  expect(() =>
    validateTicketDescriptionSources(
      "[x](https://example.com) ![y](/aufgaben/attachments/a)",
    ),
  ).not.toThrow();
});

it("passes a description without attachments through", async () => {
  await expect(save(setup(), "plain [x](https://example.com)")).resolves.toBe(
    "plain [x](https://example.com)",
  );
});

it("keeps an attachment of the same ticket", async () => {
  const text = "![x](/aufgaben/attachments/a1)";

  await expect(save(setup(), text)).resolves.toBe(text);
  expect(state.filesRequireFile).toHaveBeenCalledWith("file");
});

it("rejects an unknown attachment and a missing file", async () => {
  state.attachmentFind.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

  await expect(
    save(setup(), "![x](/aufgaben/attachments/a1)"),
  ).rejects.toMatchObject({ code: "attachmentUnavailable" });

  state.attachmentFind.mockResolvedValue({ storageName: "f", workItemId: "t" });
  state.filesRequireFile.mockRejectedValue(new Error("gone"));

  await expect(
    save(setup(), "![x](/aufgaben/attachments/a1)"),
  ).rejects.toMatchObject({ code: "attachmentUnavailable" });
});

it("accepts an attachment of another ticket the actor may read", async () => {
  state.attachmentFind.mockResolvedValue({ storageName: "f", workItemId: "o" });
  const authorize = vi.fn(async () => {});
  const text = "![x](/aufgaben/attachments/a1) ![y](/aufgaben/attachments/a1)";

  await expect(save(setup(), text, authorize)).resolves.toBe(text);
  expect(authorize).toHaveBeenCalledTimes(1);
});

it("rejects an attachment of another ticket without authorization", async () => {
  state.attachmentFind.mockResolvedValue({ storageName: "f", workItemId: "o" });

  await expect(
    save(setup(), "![x](/aufgaben/attachments/a1)"),
  ).rejects.toMatchObject({ code: "attachmentUnavailable" });
  await expect(
    save(setup(), "![x](/aufgaben/attachments/a1)", async () => {
      throw new Error("denied");
    }),
  ).rejects.toMatchObject({ code: "attachmentUnavailable" });
});

it("rejects an attachment of another ticket that was not authorized", async () => {
  state.attachmentFind
    .mockResolvedValueOnce(null)
    .mockResolvedValue({ storageName: "f", workItemId: "o" });

  await expect(
    save(setup(), "![x](/aufgaben/attachments/a1)", async () => {}),
  ).rejects.toMatchObject({ code: "attachmentUnavailable" });
});

it("promotes a staged upload and removes the staged asset", async () => {
  const harness = setup();
  const text = "![x](/agent-assets/a1) and ![y](/agent-assets/a1)";

  const result = await save(harness, text);

  expect(result).toMatch(
    /^!\[x\]\(\/aufgaben\/attachments\/[\w-]+\) and !\[y\]\(\/aufgaben\/attachments\/[\w-]+\)$/u,
  );
  expect(state.attachmentInsert).toHaveBeenCalledTimes(1);
  expect(state.assetRemove).toHaveBeenCalledWith("a1");
  harness.onRollback.mock.calls[0]?.[0]();
  harness.onCommit.mock.calls[0]?.[0]();
  expect(state.filesRemove).toHaveBeenCalledWith(["stored"]);
  expect(state.stagingRemove).toHaveBeenCalledWith(["staged-a1"]);
});

it("keeps a staged asset referenced by another ticket", async () => {
  state.auditTickets.mockResolvedValue([
    { description: "![x](/agent-assets/a1)", id: "o" },
    { description: "![x](/agent-assets/other)", id: "o2" },
    { description: "![x](/agent-assets/a1)", id: "t" },
  ]);

  await save(setup(), "![x](/agent-assets/a1)");

  expect(state.assetRemove).not.toHaveBeenCalled();
});

it("promotes when other tickets do not reference the asset", async () => {
  state.auditTickets.mockResolvedValue([
    { description: "![x](/aufgaben/attachments/a1)", id: "o" },
  ]);

  await save(setup(), "![x](/agent-assets/a1)");

  expect(state.assetRemove).toHaveBeenCalledTimes(1);
});

it.each([
  ["missing", null],
  ["foreign", { ...asset, userId: "x" }],
  ["not staged", { ...asset, status: "done" }],
  ["expired", { ...asset, expiresAt: 0 }],
])("rejects a %s upload", async (ignoredName, found) => {
  state.assetFind.mockResolvedValue(found);

  await expect(save(setup(), "![x](/agent-assets/a1)")).rejects.toMatchObject({
    code: "attachmentUploadUnavailable",
  });
});

it("requires transaction file effects for a promotion", async () => {
  await expect(save(setup(false), "![x](/agent-assets/a1)")).rejects.toThrow(
    "Ticket upload promotion requires transaction file effects.",
  );
});

it("rejects an upload whose copy differs", async () => {
  state.filesWrite.mockResolvedValue({ ...stored, checksum: "other" });

  await expect(save(setup(), "![x](/agent-assets/a1)")).rejects.toMatchObject({
    code: "attachmentUploadUnavailable",
  });
  expect(state.filesRemove).toHaveBeenCalledWith(["stored"]);

  state.filesWrite.mockResolvedValue({ ...stored, size: 9 });

  await expect(save(setup(), "![x](/agent-assets/a1)")).rejects.toMatchObject({
    code: "attachmentUploadUnavailable",
  });
});

it("rejects an upload that cannot be copied", async () => {
  state.filesWrite.mockRejectedValue(new Error("disk"));

  await expect(save(setup(), "![x](/agent-assets/a1)")).rejects.toMatchObject({
    code: "attachmentUploadUnavailable",
  });
});

it("rejects a description that is too long", async () => {
  await expect(save(setup(), "a".repeat(65_537))).rejects.toMatchObject({
    code: "descriptionTooLong",
  });
});
