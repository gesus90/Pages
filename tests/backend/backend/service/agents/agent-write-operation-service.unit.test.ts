import { beforeEach, expect, it, vi } from "vitest";

import { AgentWriteOperationService } from "@/backend/service/agents/AgentWriteOperationService";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentWriteDependencies } from "@/backend/service/agents/AgentWriteOperationService";
import type { AgentIdentity } from "@/definition/McpAuthorization";

const actor = { id: "user", isActive: true, mustChangePassword: false };
const getById = vi.fn();
const validateFileName = vi.fn();
const issue = vi.fn();
const authorize = vi.fn();
const create = vi.fn();
const service = new AgentWriteOperationService(
  partial<AgentWriteDependencies>({
    users: { getById },
    assets: { validateFileName },
    tickets: { issue },
    ticketUploads: { authorize },
    create: { create },
    wiki: {
      getSettings: async () => ({ mediaLimitBytes: 100, fileLimitBytes: 50 }),
    },
  }),
);
const identity = partial<AgentIdentity>({
  userId: "user",
  isAdmin: false,
  permissions: ["write"],
  run: null,
});
const ticketId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const wiki = {
  operationId: "op",
  projectId: "project",
  parentId: null,
  title: "Title",
  content: "Content",
  icon: null,
  assetIds: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  getById.mockResolvedValue(actor);
  validateFileName.mockReturnValue("file.txt");
  issue.mockReturnValue({ ticket: "capability" });
  create.mockResolvedValue({ pageId: "page" });
});

it("issues an upload capability only after authorizing the destination", async () => {
  const result = await service.prepare(identity, "token", {
    fileName: "file.txt",
    ticketId,
  });
  expect(result.result).toMatchObject({
    ticket: "capability",
    header: "X-Pages-Upload-Ticket",
    uploadPath: "/api/v1/agent-assets",
    mediaLimitBytes: 100,
    fileLimitBytes: 50,
  });
  expect(authorize).toHaveBeenCalledWith(identity, ticketId);
  expect(issue).toHaveBeenCalledWith("token", "user", "file.txt", ticketId);
  expect(authorize.mock.invocationCallOrder[0]).toBeLessThan(
    issue.mock.invocationCallOrder[0],
  );
});

it("refuses write-restricted identities and malformed metadata", async () => {
  await expect(
    service.prepare(
      partial<AgentIdentity>({ ...identity, permissions: [] }),
      "token",
      { fileName: "file.txt" },
    ),
  ).rejects.toThrow();
  await expect(
    service.prepare(identity, "token", {
      fileName: "file.txt",
      ticketId: "invalid",
    }),
  ).rejects.toThrow();
  expect(issue).not.toHaveBeenCalled();
});

it("resolves a fresh active account before creating a wiki page", async () => {
  expect((await service.create(identity, wiki)).result).toEqual({
    pageId: "page",
  });
  expect(create).toHaveBeenCalledWith(actor, wiki);
  getById.mockResolvedValueOnce({ ...actor, isActive: false });
  await expect(service.create(identity, wiki)).rejects.toThrow();
  await expect(service.create(identity, null)).rejects.toThrow();
});
