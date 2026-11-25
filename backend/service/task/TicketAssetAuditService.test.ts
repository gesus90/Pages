import { lstat } from "node:fs/promises";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { TicketAssetAuditService } from "./TicketAssetAuditService";

import type { Stats } from "node:fs";
import type { DatabaseTransaction } from "@/backend/database/Database";
import type * as TicketFileStoreModule from "@/backend/storage/TicketFileStore";

const state = vi.hoisted(() => ({
  assets: new Map<string, object>(),
  attachments: [] as object[],
  inspect: vi.fn(),
  tickets: [] as object[],
}));

vi.mock("node:fs/promises", () => ({ lstat: vi.fn() }));
vi.mock(
  "@/backend/database/repositories/task/TicketAssetAuditRepository",
  () => ({
    TicketAssetAuditRepository: class {
      public tickets = async (): Promise<object[]> => state.tickets;
    },
  }),
);
vi.mock(
  "@/backend/database/repositories/task/WorkItemAttachmentRepository",
  () => ({
    WorkItemAttachmentRepository: class {
      public listAll = async (): Promise<object[]> => state.attachments;
    },
  }),
);
vi.mock("@/backend/database/repositories/agents/AgentAssetRepository", () => ({
  AgentAssetRepository: class {
    public find = async (id: string): Promise<object | null> =>
      state.assets.get(id) ?? null;
  },
}));
vi.mock("@/backend/storage/TicketFileStore", async (original) => {
  const actual = await original<typeof TicketFileStoreModule>();

  return {
    ...actual,
    TicketFileStore: class {
      public inspect = state.inspect;
    },
  };
});

function doubleOf<Type>(value: unknown): Type {
  return value as Type;
}

const UUID = "11111111-1111-1111-1111-111111111111";
const ASSET_PATH = `assets/${UUID}/${UUID}.png`;

function service(): TicketAssetAuditService {
  return new TicketAssetAuditService(doubleOf<DatabaseTransaction>({}), "/d");
}

function attachmentOf(
  id: string,
  overrides: Record<string, unknown> = {},
): object {
  return {
    checksum: "c",
    id,
    size: 1,
    storageName: ASSET_PATH,
    workItemId: "t1",
    ...overrides,
  };
}

function fileOf(isFile: boolean, size: number): Stats {
  return doubleOf<Stats>({ isFile: () => isFile, size });
}

beforeEach(() => {
  state.assets.clear();
  state.attachments = [];
  state.tickets = [{ description: "", id: "t1", key: "A-1" }];
  state.inspect.mockReset();
  state.inspect.mockResolvedValue({ checksum: "c", size: 1 });
  vi.mocked(lstat).mockReset();
  vi.mocked(lstat).mockResolvedValue(fileOf(true, 5));
});

describe("TicketAssetAuditService.referencedUploadIds", () => {
  it("collects only agent upload links", async () => {
    state.tickets = [
      {
        description: `![a](/agent-assets/${UUID}) [b](/aufgaben/attachments/${UUID}) [c](/x)`,
        id: "t1",
        key: "A-1",
      },
    ];

    await expect(service().referencedUploadIds()).resolves.toEqual(
      new Set([UUID]),
    );
  });
});

describe("TicketAssetAuditService.inspect external references", () => {
  it("reports external images but not external links", async () => {
    state.tickets = [
      {
        description: "![a](https://x.test/a.png) [b](https://x.test)",
        id: "t1",
        key: "A-1",
      },
    ];

    const audit = await service().inspect();

    expect(audit.findings).toEqual([
      {
        reason: "externalImage",
        reference: "https://x.test/a.png",
        ticketId: "t1",
        ticketKey: "A-1",
      },
    ]);
    expect(audit.ticketCount).toBe(1);
    expect(audit.attachmentCount).toBe(0);
  });

  it("reports a missing attachment and a healthy one", async () => {
    state.attachments = [attachmentOf("ok", { workItemId: "t2" })];
    state.tickets = [
      {
        description: `[a](/aufgaben/attachments/ok) [b](/aufgaben/attachments/gone)`,
        id: "t1",
        key: "A-1",
      },
    ];

    const audit = await service().inspect();

    expect(audit.findings.map((finding) => finding.reason)).toEqual([
      "missingAttachment",
    ]);
  });
});

describe("TicketAssetAuditService.inspect upload references", () => {
  it("classifies upload links by their state", async () => {
    state.assets.set("linked", { status: "linked" });
    state.assets.set("staged", {
      expiresAt: Date.now() + 10_000,
      size: 5,
      status: "staged",
      storageName: "../s",
    });
    state.assets.set("expired", {
      expiresAt: 0,
      size: 5,
      status: "staged",
      storageName: "e",
    });
    state.assets.set("other", {
      expiresAt: Date.now() + 10_000,
      size: 5,
      status: "other",
      storageName: "o",
    });
    state.tickets = [
      {
        description: ["none", "linked", "staged", "expired", "other"]
          .map((id) => `[x](/agent-assets/${id})`)
          .join(" "),
        id: "t1",
        key: "A-1",
      },
    ];

    const audit = await service().inspect();

    expect(
      Object.fromEntries(
        audit.findings.map((finding) => [finding.reference, finding.reason]),
      ),
    ).toEqual({
      "/agent-assets/expired": "expiredUpload",
      "/agent-assets/linked": "outsideTicketStorage",
      "/agent-assets/none": "missingUpload",
      "/agent-assets/other": "expiredUpload",
      "/agent-assets/staged": "temporaryUpload",
    });
    expect(lstat).toHaveBeenCalledWith("/d/agent-assets/s");
  });

  it("reports an upload whose file is not usable", async () => {
    state.assets.set("a", { size: 5, status: "staged", storageName: "a" });
    state.assets.set("b", { size: 5, status: "staged", storageName: "b" });
    state.assets.set("c", { size: 5, status: "staged", storageName: "c" });
    vi.mocked(lstat)
      .mockResolvedValueOnce(fileOf(false, 5))
      .mockResolvedValueOnce(fileOf(true, 9))
      .mockRejectedValueOnce(new Error("missing"));
    state.tickets = [
      {
        description:
          "[x](/agent-assets/a) [y](/agent-assets/b) [z](/agent-assets/c)",
        id: "t1",
        key: "A-1",
      },
    ];

    const audit = await service().inspect();

    expect(audit.findings.map((finding) => finding.reason)).toEqual([
      "missingUploadFile",
      "missingUploadFile",
      "missingUploadFile",
    ]);
  });
});

describe("TicketAssetAuditService.inspect attachment findings", () => {
  it("checks the file of an attachment referenced from the description", async () => {
    state.attachments = [attachmentOf("m")];
    state.tickets = [
      {
        description: "[a](/aufgaben/attachments/m)",
        id: "t1",
        key: "A-1",
      },
    ];
    state.inspect.mockResolvedValue({ checksum: "other", size: 1 });

    const audit = await service().inspect();

    expect(audit.findings).toHaveLength(1);
    expect(audit.findings[0].reason).toBe("checksumMismatch");
  });

  it("reports nothing for a healthy attachment of the ticket", async () => {
    state.attachments = [attachmentOf("fine")];

    await expect(service().inspect()).resolves.toMatchObject({
      attachmentCount: 1,
      findings: [],
    });
  });

  it("flags size mismatches, legacy storage and missing files", async () => {
    state.attachments = [
      attachmentOf("size"),
      attachmentOf("legacy", { storageName: UUID }),
      attachmentOf("gone"),
    ];
    state.inspect
      .mockResolvedValueOnce({ checksum: "c", size: 2 })
      .mockResolvedValueOnce({ checksum: "c", size: 1 })
      .mockRejectedValueOnce(new Error("missing"));

    const audit = await service().inspect();

    expect(audit.attachmentCount).toBe(3);
    expect(
      audit.findings.map((finding) => [finding.reference, finding.reason]),
    ).toEqual([
      ["/aufgaben/attachments/size", "checksumMismatch"],
      ["/aufgaben/attachments/gone", "missingFile"],
      ["/aufgaben/attachments/legacy", "legacyStorage"],
    ]);
  });

  it("deduplicates findings and sorts by priority then ticket key", async () => {
    state.tickets = [
      {
        description: "![a](https://x.test/1.png) ![a](https://x.test/1.png)",
        id: "t2",
        key: "B-2",
      },
      {
        description: "![a](https://x.test/2.png)",
        id: "t1",
        key: "A-1",
      },
    ];
    state.attachments = [attachmentOf("m", { workItemId: "t2" })];
    state.inspect.mockRejectedValue(new Error("missing"));

    const audit = await service().inspect();

    expect(
      audit.findings.map((finding) => [finding.ticketKey, finding.reason]),
    ).toEqual([
      ["B-2", "missingFile"],
      ["A-1", "externalImage"],
      ["B-2", "externalImage"],
    ]);
    expect(new Date(audit.checkedAt).getTime()).not.toBeNaN();
  });
});
