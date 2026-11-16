import { beforeEach, expect, it, vi } from "vitest";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentWikiCommentDependencies } from "@/backend/service/agents/AgentWikiCommentService";
import type { AgentIdentity } from "@/definition/McpAuthorization";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  find: vi.fn(),
  insert: vi.fn(),
  commentFind: vi.fn(),
  listByPage: vi.fn(),
  list: vi.fn(),
  add: vi.fn(),
  edit: vi.fn(),
  resolve: vi.fn(),
  remove: vi.fn(),
  require: vi.fn(),
  resolveAccess: vi.fn(),
  event: vi.fn(),
}));
vi.mock("@/backend/database/repositories/UserRepository", () => ({
  UserRepository: class {
    public findById = mocks.user;
  },
}));
vi.mock("@/backend/database/repositories/ProjectRepository", () => ({
  ProjectRepository: class {},
}));
vi.mock("@/backend/database/repositories/WikiRepository", () => ({
  WikiRepository: class {
    public comments = { find: mocks.commentFind, listByPage: mocks.listByPage };
  },
}));
vi.mock(
  "@/backend/database/repositories/agents/AgentOperationKeyRepository",
  () => ({
    AgentOperationKeyRepository: class {
      public find = mocks.find;
      public insert = mocks.insert;
    },
  }),
);
vi.mock("@/backend/service/wiki/WikiCommentService", () => ({
  WikiCommentService: class {
    public list = mocks.list;
    public add = mocks.add;
    public edit = mocks.edit;
    public resolve = mocks.resolve;
    public remove = mocks.remove;
  },
}));
vi.mock("@/backend/service/wiki/WikiPageReader", () => ({
  WikiPageReader: class {
    public require = mocks.require;
  },
}));
vi.mock("@/backend/service/agents/AgentWikiAccess", () => ({
  createAgentWikiAccess: () => ({ resolve: mocks.resolveAccess }),
}));
vi.mock("@/backend/service/events/PagesEventPublisher", () => ({
  recordPagesEvent: mocks.event,
}));

import { AgentWikiCommentService } from "@/backend/service/agents/AgentWikiCommentService";

const transaction = { execute: vi.fn(), query: vi.fn() };
const publish = vi.fn();
const service = new AgentWikiCommentService(
  partial<AgentWikiCommentDependencies>({
    database: {
      transaction: async (
        work: (value: typeof transaction) => Promise<unknown>,
      ) => work(transaction),
    },
    events: { publish },
  }),
);
const identity = partial<AgentIdentity>({ userId: "user" });
const comment = {
  id: "comment",
  pageId: "page",
  authorId: "user",
  parentId: null,
  body: "Text",
  resolvedAt: null,
  isStale: false,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({
    id: "user",
    isActive: true,
    mustChangePassword: false,
  });
  mocks.resolveAccess.mockResolvedValue({ scope: {} });
  mocks.find.mockResolvedValue(null);
  mocks.commentFind.mockResolvedValue(comment);
  mocks.add.mockResolvedValue(comment);
  mocks.listByPage.mockResolvedValue([
    comment,
    { ...comment, id: "reply", parentId: "comment" },
  ]);
});

it("adds a comment transactionally and publishes the committed page change", async () => {
  const response = await service.apply(identity, "wiki.comment.add", {
    operationId: "op",
    pageId: "page",
    body: "Text",
  });
  expect(response.result).toMatchObject({
    commentId: "comment",
    pageId: "page",
    parentId: null,
  });
  expect(mocks.add).toHaveBeenCalledOnce();
  expect(mocks.insert).toHaveBeenCalledOnce();
  expect(mocks.event).toHaveBeenCalledOnce();
  expect(publish).toHaveBeenCalledWith({
    type: "wiki.comments.changed",
    id: "page",
  });
});

it("does not rewrite an unchanged comment or emit an event", async () => {
  const response = await service.apply(identity, "wiki.comment.edit", {
    operationId: "op",
    commentId: "comment",
    body: " Text ",
  });
  expect(response.result).toMatchObject({ action: "edited", changed: false });
  expect(mocks.edit).not.toHaveBeenCalled();
  expect(publish).not.toHaveBeenCalled();
});

it("resolves only root comments and counts removed replies", async () => {
  expect(
    (
      await service.apply(identity, "wiki.comment.resolve", {
        operationId: "op",
        commentId: "comment",
        resolved: true,
      })
    ).result,
  ).toMatchObject({ action: "resolved", changed: true });
  expect(mocks.resolve).toHaveBeenCalledOnce();
  expect(
    (
      await service.apply(identity, "wiki.comment.delete", {
        operationId: "other",
        commentId: "comment",
      })
    ).result,
  ).toMatchObject({ action: "deleted", deletedComments: 2 });
  mocks.commentFind.mockResolvedValueOnce({ ...comment, parentId: "parent" });
  await expect(
    service.apply(identity, "wiki.comment.resolve", {
      operationId: "third",
      commentId: "comment",
      resolved: true,
    }),
  ).rejects.toThrow();
});

it("rejects inactive users and unknown fields before a write", async () => {
  mocks.user.mockResolvedValueOnce({ id: "user", isActive: false });
  await expect(
    service.apply(identity, "wiki.comment.add", {
      operationId: "op",
      pageId: "page",
      body: "Text",
    }),
  ).rejects.toThrow();
  await expect(
    service.apply(identity, "wiki.comment.add", {
      operationId: "op",
      pageId: "page",
      body: "Text",
      extra: true,
    }),
  ).rejects.toThrow();
  expect(mocks.add).not.toHaveBeenCalled();
});
