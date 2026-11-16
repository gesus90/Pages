import { beforeEach, expect, it, vi } from "vitest";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { DatabaseTransaction } from "@/backend/database/Database";

const boundary = vi.hoisted(() => ({
  tickets: vi.fn(),
  attachments: vi.fn(),
  asset: vi.fn(),
  inspect: vi.fn(),
  lstat: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({ lstat: boundary.lstat }));
vi.mock(
  "@/backend/database/repositories/task/TicketAssetAuditRepository",
  () => ({
    TicketAssetAuditRepository: class {
      public tickets = boundary.tickets;
    },
  }),
);
vi.mock(
  "@/backend/database/repositories/task/WorkItemAttachmentRepository",
  () => ({
    WorkItemAttachmentRepository: class {
      public listAll = boundary.attachments;
    },
  }),
);
vi.mock("@/backend/database/repositories/agents/AgentAssetRepository", () => ({
  AgentAssetRepository: class {
    public find = boundary.asset;
  },
}));
vi.mock("@/backend/storage/TicketFileStore", () => ({
  TicketFileStore: class {
    public inspect = boundary.inspect;
  },
  isTicketAssetPath: (name: string) => name.startsWith("tickets/"),
}));

import { TicketAssetAuditService } from "@/backend/service/task/TicketAssetAuditService";

const service = new TicketAssetAuditService(
  partial<DatabaseTransaction>({}),
  "/simulated",
);

beforeEach(() => {
  vi.resetAllMocks();
  boundary.tickets.mockResolvedValue([
    {
      id: "ticket",
      key: "P-1",
      description:
        "![outside](https://example.com/image.png)\n[upload](/agent-assets/upload)\n[file](/aufgaben/attachments/missing)",
    },
  ]);
  boundary.attachments.mockResolvedValue([]);
  boundary.asset.mockResolvedValue(null);
});

it("reports broken and external references without fetching them", async () => {
  const report = await service.inspect();
  expect(report).toMatchObject({
    ticketCount: 1,
    attachmentCount: 0,
  });
  expect(report.findings).toEqual(
    expect.arrayContaining([
      {
        ticketId: "ticket",
        ticketKey: "P-1",
        reference: "/agent-assets/upload",
        reason: "missingUpload",
      },
      {
        ticketId: "ticket",
        ticketKey: "P-1",
        reference: "/aufgaben/attachments/missing",
        reason: "missingAttachment",
      },
      {
        ticketId: "ticket",
        ticketKey: "P-1",
        reference: "https://example.com/image.png",
        reason: "externalImage",
      },
    ]),
  );
  expect(await service.referencedUploadIds()).toEqual(new Set(["upload"]));
});

it("classifies temporary, expired and missing staged files", async () => {
  boundary.tickets.mockResolvedValue([
    { id: "ticket", key: "P-1", description: "[upload](/agent-assets/upload)" },
  ]);
  boundary.asset.mockResolvedValue({
    storageName: "file",
    size: 4,
    status: "staged",
    expiresAt: Date.now() + 10000,
  });
  boundary.lstat.mockResolvedValue({ isFile: () => true, size: 4 });
  expect((await service.inspect()).findings[0].reason).toBe("temporaryUpload");
  boundary.asset.mockResolvedValue({
    storageName: "file",
    size: 4,
    status: "staged",
    expiresAt: 0,
  });
  expect((await service.inspect()).findings[0].reason).toBe("expiredUpload");
  boundary.lstat.mockRejectedValue(new Error("missing"));
  expect((await service.inspect()).findings[0].reason).toBe(
    "missingUploadFile",
  );
});

it("checks attachment size and checksum using a simulated file store", async () => {
  boundary.tickets.mockResolvedValue([
    { id: "ticket", key: "P-1", description: "" },
  ]);
  boundary.attachments.mockResolvedValue([
    {
      id: "attachment",
      workItemId: "ticket",
      storageName: "tickets/file",
      size: 4,
      checksum: "hash",
    },
  ]);
  boundary.inspect.mockResolvedValue({ size: 4, checksum: "wrong" });
  expect((await service.inspect()).findings[0].reason).toBe("checksumMismatch");
  boundary.inspect.mockResolvedValue({ size: 4, checksum: "hash" });
  expect((await service.inspect()).findings).toEqual([]);
  boundary.inspect.mockRejectedValue(new Error("missing"));
  expect((await service.inspect()).findings[0].reason).toBe("missingFile");
});
