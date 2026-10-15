import { beforeEach, expect, it, vi } from "vitest";

import { PermissionService } from "@/backend/auth/PermissionService";
import { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import { WikiPageRepository } from "@/backend/database/repositories/wiki/WikiPageRepository";
import { WikiPageWriteRepository } from "@/backend/database/repositories/wiki/WikiPageWriteRepository";
import { WikiAnchorRepository } from "@/backend/database/repositories/wiki/WikiAnchorRepository";
import { WikiVersionRepository } from "@/backend/database/repositories/wiki/WikiVersionRepository";
import { WikiLinkRepository } from "@/backend/database/repositories/wiki/WikiLinkRepository";
import {
  WikiAccessDeniedError,
  WikiPageNotFoundError,
  WikiValidationError,
} from "@/backend/error/WikiErrors";
import { WikiAccess } from "@/backend/service/wiki/WikiAccess";
import { WikiPageService } from "@/backend/service/wiki/WikiPageService";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { WikiPageRecord } from "@/backend/database/repositories/WikiRepository";
import type { WikiViewer } from "@/backend/service/wiki/WikiAccess";
import type { User } from "@/definition/User";

vi.mock("@/backend/service/wiki/WikiActivity", () => ({
  recordWikiActivity: vi.fn(),
}));
vi.mock("@/backend/service/wiki/WikiMentions", () => ({
  syncMentions: vi.fn(),
}));

const actor: User = {
  id: "owner",
  username: "owner",
  displayName: "Owner",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};
const scope = {
  userId: actor.id,
  isAdmin: false,
  departmentIds: [],
  projectIds: [],
};
const viewer: WikiViewer = {
  user: actor,
  scope,
  canWrite: true,
  canManageProjects: false,
};
const boundary: DatabaseTransaction = { execute: vi.fn(), query: vi.fn() };
const repository = new WikiRepository({
  ...boundary,
  transaction: async <Result>(
    work: (transaction: DatabaseTransaction) => Promise<Result>,
  ): Promise<Result> => work(boundary),
});
const access = new WikiAccess(
  { workItemVisibility: vi.fn() },
  new PermissionService(),
);
const service = new WikiPageService(repository, access);
let stored: WikiPageRecord;

beforeEach(() => {
  stored = {
    id: "page",
    title: "Title",
    content: "old",
    icon: null,
    revision: 1,
    cover: null,
    scope: "instance",
    projectId: null,
    projectName: null,
    parentId: null,
    ownerId: "owner",
    ownerName: "Owner",
    currentUntil: null,
    updatedAt: "2026-10-15 10:00:00",
    createdAt: "2026-10-15 10:00:00",
    isTemplate: false,
    updatedByName: "Owner",
  };
  vi.spyOn(access, "resolve").mockResolvedValue(viewer);
  vi.spyOn(WikiPageRepository.prototype, "findVisible").mockImplementation(
    async () => stored,
  );
  vi.spyOn(WikiPageRepository.prototype, "findBreadcrumb").mockResolvedValue(
    [],
  );
  vi.spyOn(WikiAnchorRepository.prototype, "findAnchors").mockResolvedValue([]);
  vi.spyOn(WikiVersionRepository.prototype, "save").mockResolvedValue(
    undefined,
  );
  vi.spyOn(WikiLinkRepository.prototype, "replace").mockResolvedValue(
    undefined,
  );
  vi.spyOn(WikiPageWriteRepository.prototype, "saveEdit").mockImplementation(
    async (pageId, edit) => {
      stored = {
        ...stored,
        id: pageId,
        ...edit,
        revision: stored.revision + 1,
      };
      return stored.revision;
    },
  );
});

it("acknowledges a repeated save after response loss without another edit or history entry", async () => {
  const edit = {
    title: "Title",
    content: "new",
    icon: null,
    expectedRevision: 1,
  };
  const first = await service.update(actor, "page", edit);
  const retry = await service.update(actor, "page", edit);
  expect(first.revision).toBe(2);
  expect(retry.revision).toBe(2);
  expect(WikiPageWriteRepository.prototype.saveEdit).toHaveBeenCalledOnce();
  expect(WikiVersionRepository.prototype.save).toHaveBeenCalledOnce();
});

it("refuses an old write after a different edit and returns the remote version", async () => {
  await service.update(actor, "page", {
    title: "Title",
    content: "theirs",
    icon: null,
    expectedRevision: 1,
  });
  await expect(
    service.update(actor, "page", {
      title: "Title",
      content: "mine",
      icon: null,
      expectedRevision: 1,
    }),
  ).rejects.toMatchObject({ current: { content: "theirs", revision: 2 } });
  expect(stored.content).toBe("theirs");
  expect(WikiPageWriteRepository.prototype.saveEdit).toHaveBeenCalledOnce();
});

it("rechecks rights even for a retry and validates before persistence", async () => {
  vi.mocked(access.resolve).mockResolvedValueOnce({
    ...viewer,
    canWrite: false,
  });
  await expect(
    service.update(actor, "page", {
      title: "Title",
      content: "old",
      icon: null,
      expectedRevision: 1,
    }),
  ).rejects.toBeInstanceOf(WikiAccessDeniedError);
  await expect(
    service.update(actor, "page", {
      title: " ",
      content: "new",
      icon: null,
      expectedRevision: 1,
    }),
  ).rejects.toBeInstanceOf(WikiValidationError);
  vi.mocked(WikiPageRepository.prototype.findVisible).mockResolvedValueOnce(
    null,
  );
  await expect(
    service.update(actor, "hidden", {
      title: "Title",
      content: "old",
      icon: null,
      expectedRevision: 1,
    }),
  ).rejects.toBeInstanceOf(WikiPageNotFoundError);
  expect(WikiPageWriteRepository.prototype.saveEdit).not.toHaveBeenCalled();
});
