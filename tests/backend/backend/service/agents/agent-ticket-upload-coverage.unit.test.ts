import { beforeEach, expect, it, vi } from "vitest";

import { AgentTicketUploadService } from "@/backend/service/agents/AgentTicketUploadService";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { Database } from "@/backend/database/Database";
import type { UploadedFile } from "@/backend/service/WikiService";
import type { UploadLimitSource } from "@/backend/service/task/TaskAttachmentService";
import type { AgentIdentity } from "@/definition/McpAuthorization";

const boundary = vi.hoisted(() => ({
  find: vi.fn(),
  authorize: vi.fn(),
  upload: vi.fn(),
}));
vi.mock("@/backend/database/repositories/UserRepository", () => ({
  UserRepository: class {
    public findById = boundary.find;
  },
}));
vi.mock(
  "@/backend/database/repositories/task/WorkItemAttachmentRepository",
  () => ({ WorkItemAttachmentRepository: class {} }),
);
vi.mock("@/backend/storage/TicketFileStore", () => ({
  TicketFileStore: class {},
}));
vi.mock("@/backend/service/agents/AgentTaskAccess", () => ({
  createAgentTaskContext: () => ({ tasks: {} }),
}));
vi.mock("@/backend/service/task/TaskAttachmentService", () => ({
  TaskAttachmentService: class {
    public authorizeUpload = boundary.authorize;
    public upload = boundary.upload;
  },
}));

const identity = partial<AgentIdentity>({
  userId: "user",
  isAdmin: false,
  permissions: ["write"],
});
const file = partial<UploadedFile>({ name: "report.txt" });

function service(): AgentTicketUploadService {
  return new AgentTicketUploadService(
    partial<Database>({}),
    "/instance",
    partial<UploadLimitSource>({}),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  boundary.find.mockResolvedValue({
    id: "user",
    isActive: true,
    mustChangePassword: false,
  });
  boundary.authorize.mockResolvedValue(undefined);
  boundary.upload.mockResolvedValue({
    id: "attachment",
    fileName: "report.txt",
    contentType: "text/plain",
    size: 5,
  });
});

it("authorizes uploads through the current actor and maps the permanent attachment", async () => {
  const uploader = service();
  await uploader.authorize(identity, "ticket");
  expect(boundary.authorize).toHaveBeenCalledWith(
    expect.objectContaining({ id: "user" }),
    "ticket",
  );
  await expect(
    uploader.upload(file, async () => identity, "ticket"),
  ).resolves.toEqual({
    assetId: "attachment",
    link: "/aufgaben/attachments/attachment",
    fileName: "report.txt",
    contentType: "text/plain",
    size: 5,
    expiresAt: null,
  });
});

it("refuses reduced run rights, missing write permission and inactive users", async () => {
  const uploader = service();
  await expect(
    uploader.authorize(
      { ...identity, run: partial({ reach: "read" }) },
      "ticket",
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    uploader.authorize({ ...identity, permissions: [] }, "ticket"),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  boundary.find.mockResolvedValue({ id: "user", isActive: false });
  await expect(uploader.authorize(identity, "ticket")).rejects.toMatchObject({
    status: 401,
  });
  expect(boundary.authorize).not.toHaveBeenCalled();
});
