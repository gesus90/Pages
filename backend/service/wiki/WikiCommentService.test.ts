import { expect, it, vi } from "vitest";

import {
  WikiAccessDeniedError,
  WikiPageNotFoundError,
  WikiValidationError,
} from "@/backend/error/WikiErrors";

import { WikiCommentService } from "./WikiCommentService";

import type {
  StoredWikiComment,
  WikiPageRecord,
  WikiRepository,
} from "@/backend/database/repositories/WikiRepository";
import type { User } from "@/definition/User";
import type { WikiAccess, WikiViewer } from "./WikiAccess";
import type { CommentInput } from "./WikiCommentService";

const ACTOR = { id: "u1" } as unknown as User;

function viewerOf(isAdmin = false): WikiViewer {
  return {
    canManageProjects: false,
    canWrite: true,
    scope: {
      departmentIds: [],
      isAdmin,
      projectIds: [],
      userId: "u1",
    },
    user: ACTOR,
  };
}

function pageOf(overrides: Partial<WikiPageRecord> = {}): WikiPageRecord {
  return {
    content: "Hello **world**",
    id: "p1",
    ownerId: "owner",
    projectId: "pr1",
    scope: "project",
    ...overrides,
  } as unknown as WikiPageRecord;
}

function commentOf(
  overrides: Partial<StoredWikiComment> = {},
): StoredWikiComment {
  return {
    authorId: "u1",
    authorName: "Ada",
    body: "text",
    createdAt: "c",
    id: "c1",
    pageId: "p1",
    parentId: null,
    quote: null,
    quotePrefix: null,
    quoteSuffix: null,
    resolvedAt: null,
    resolvedByName: null,
    updatedAt: "u",
    ...overrides,
  };
}

type Mocks = Record<string, Record<string, ReturnType<typeof vi.fn>>>;

function serviceOf(
  options: {
    readonly page?: WikiPageRecord | null;
    readonly comments?: Record<string, StoredWikiComment>;
    readonly viewer?: WikiViewer;
  } = {},
): { readonly service: WikiCommentService; readonly mocks: Mocks } {
  const page = options.page === undefined ? pageOf() : options.page;
  const comments = options.comments ?? { c1: commentOf() };
  const mocks: Mocks = {
    activity: { insert: vi.fn(async () => {}) },
    comments: {
      delete: vi.fn(async () => {}),
      find: vi.fn(async (id: string) => comments[id] ?? null),
      insert: vi.fn(async () => "c1"),
      listByPage: vi.fn(async () => Object.values(comments)),
      setResolved: vi.fn(async () => {}),
      updateBody: vi.fn(async () => {}),
    },
    lookups: {
      findActiveUsersByUsernames: vi.fn(async () => [{ id: "m1" }]),
    },
    mentions: { replace: vi.fn(async () => {}) },
    pages: { findVisible: vi.fn(async () => page) },
  };
  const repository = {
    ...mocks,
    transaction: vi.fn(async (work: (r: unknown) => Promise<unknown>) =>
      work(repository),
    ),
  };
  const access = {
    resolve: vi.fn(async () => options.viewer ?? viewerOf()),
  } as unknown as WikiAccess;

  return {
    mocks,
    service: new WikiCommentService(
      repository as unknown as WikiRepository,
      access,
    ),
  };
}

function inputOf(overrides: Partial<CommentInput> = {}): CommentInput {
  return {
    body: " hi @bob ",
    parentId: null,
    quote: null,
    quotePrefix: null,
    quoteSuffix: null,
    ...overrides,
  };
}

it("lists threads with replies and marks stale passages", async () => {
  const { service } = serviceOf({
    comments: {
      c1: commentOf({ quote: "world" }),
      c2: commentOf({ id: "c2", parentId: "c1", authorId: "x" }),
      c3: commentOf({ id: "c3", quote: "gone" }),
    },
  });

  const threads = await service.list(ACTOR, "p1");

  expect(threads.map((thread) => thread.comment.id)).toEqual(["c1", "c3"]);
  expect(threads[0]?.replies.map((reply) => reply.id)).toEqual(["c2"]);
  expect(threads[0]?.comment.isStale).toBe(false);
  expect(threads[1]?.comment.isStale).toBe(true);
  expect(threads[0]?.replies[0]?.canEdit).toBe(false);
});

it("reads one comment", async () => {
  const { service } = serviceOf();

  await expect(service.get(ACTOR, "c1")).resolves.toMatchObject({
    comment: { id: "c1", canChange: true, canEdit: true },
    parentId: null,
  });
});

it("hides a missing comment and a hidden page alike", async () => {
  await expect(serviceOf().service.get(ACTOR, "nope")).rejects.toThrow(
    WikiPageNotFoundError,
  );
  await expect(
    serviceOf({ page: null }).service.get(ACTOR, "c1"),
  ).rejects.toThrow(WikiPageNotFoundError);
});

it("adds a comment with a trimmed quote and mentions", async () => {
  const { service, mocks } = serviceOf();

  await expect(
    service.add(
      ACTOR,
      "p1",
      inputOf({ quote: " q ", quotePrefix: "  ", quoteSuffix: "s" }),
    ),
  ).resolves.toMatchObject({ id: "c1" });
  expect(mocks.comments?.insert).toHaveBeenCalledWith(
    expect.objectContaining({
      body: "hi @bob",
      quote: "q",
      quotePrefix: null,
      quoteSuffix: "s",
    }),
  );
  expect(mocks.mentions?.replace).toHaveBeenCalledWith(
    expect.objectContaining({ commentId: "c1", pageId: "p1" }),
    ["m1"],
  );
  expect(mocks.activity?.insert).toHaveBeenCalledTimes(1);
});

it("adds a reply to a first comment and skips mentions on private pages", async () => {
  const { service, mocks } = serviceOf({
    page: pageOf({ projectId: null, scope: "private" }),
  });

  await service.add(ACTOR, "p1", inputOf({ parentId: "c1", quote: null }));

  expect(mocks.mentions?.replace).not.toHaveBeenCalled();
  expect(mocks.activity?.insert).not.toHaveBeenCalled();
});

it("rejects empty, too long and misplaced comments", async () => {
  const { service } = serviceOf({
    comments: {
      c1: commentOf(),
      c2: commentOf({ id: "c2", parentId: "c1" }),
      c4: commentOf({ id: "c4", pageId: "other" }),
    },
  });

  await expect(
    service.add(ACTOR, "p1", inputOf({ body: " " })),
  ).rejects.toThrow(WikiValidationError);
  await expect(
    service.add(ACTOR, "p1", inputOf({ body: "x".repeat(5001) })),
  ).rejects.toThrow(WikiValidationError);
  for (const parentId of ["c2", "c4", "missing"]) {
    await expect(
      service.add(ACTOR, "p1", inputOf({ parentId })),
    ).rejects.toThrow(WikiValidationError);
  }
});

it("edits only an own comment", async () => {
  const { service, mocks } = serviceOf();

  await service.edit(ACTOR, "c1", " new ");

  expect(mocks.comments?.updateBody).toHaveBeenCalledWith("c1", "new");
  await expect(
    serviceOf({ comments: { c1: commentOf({ authorId: "x" }) } }).service.edit(
      ACTOR,
      "c1",
      "new",
    ),
  ).rejects.toThrow(WikiAccessDeniedError);
});

it("deletes a comment of the author, the page owner and an administrator", async () => {
  const foreign = { c1: commentOf({ authorId: "x" }) };
  const own = serviceOf();
  const owner = serviceOf({
    comments: foreign,
    page: pageOf({ ownerId: "u1" }),
  });
  const admin = serviceOf({ comments: foreign, viewer: viewerOf(true) });

  await own.service.remove(ACTOR, "c1");
  await owner.service.remove(ACTOR, "c1");
  await admin.service.remove(ACTOR, "c1");

  expect(own.mocks.comments?.delete).toHaveBeenCalledWith("c1");
  expect(owner.mocks.comments?.delete).toHaveBeenCalled();
  expect(admin.mocks.comments?.delete).toHaveBeenCalled();
});

it("refuses to delete for strangers and administrators on private pages", async () => {
  const foreign = { c1: commentOf({ authorId: "x" }) };

  await expect(
    serviceOf({ comments: foreign }).service.remove(ACTOR, "c1"),
  ).rejects.toThrow(WikiAccessDeniedError);
  await expect(
    serviceOf({
      comments: foreign,
      page: pageOf({ scope: "private" }),
      viewer: viewerOf(true),
    }).service.remove(ACTOR, "c1"),
  ).rejects.toThrow(WikiAccessDeniedError);
});

it("resolves and reopens a thread but not a reply", async () => {
  const { service, mocks } = serviceOf();

  await service.resolve(ACTOR, "c1", true);
  await service.resolve(ACTOR, "c1", false);

  expect(mocks.comments?.setResolved).toHaveBeenNthCalledWith(1, "c1", "u1");
  expect(mocks.comments?.setResolved).toHaveBeenNthCalledWith(2, "c1", null);
  await expect(
    serviceOf({
      comments: { c1: commentOf({ parentId: "c0" }) },
    }).service.resolve(ACTOR, "c1", true),
  ).rejects.toThrow(WikiValidationError);
});
