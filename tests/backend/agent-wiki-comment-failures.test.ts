import { expect, it, vi } from "vitest";

import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import { WikiCommentService } from "@/backend/service/wiki/WikiCommentService";
import { PAGES_AGENT_LIMITS } from "@/definition/PagesAgentOperations";

import {
  addAgentComment,
  COMMENT_READER,
  useAgentCommentHarness,
} from "../helpers/wiki-agent-comments";
import { wikiFieldState } from "../helpers/wiki-fields";
import { pageInput } from "../helpers/wiki-harness";

const setup = useAgentCommentHarness();

it.each(["missing", "inactive", "password"])(
  "rejects a %s account for reads and writes without persisting anything",
  async (state) => {
    const harness = await setup();
    if (state === "inactive")
      await harness.database.execute(
        "UPDATE users SET is_active = FALSE WHERE id = 'reader';",
      );
    if (state === "password")
      await harness.database.execute(
        "UPDATE users SET must_change_password = TRUE WHERE id = 'reader';",
      );
    const identity =
      state === "missing"
        ? { ...COMMENT_READER, userId: "missing" }
        : COMMENT_READER;
    const before = await wikiFieldState(harness.database, {
      includeOperationKeys: true,
    });
    await expect(
      harness.comments.read(identity, { pageId: harness.page.id }),
    ).rejects.toMatchObject({ code: "invalid_token", status: 401 });
    await expect(
      harness.comments.apply(identity, "wiki.comment.add", {
        operationId: "refused",
        pageId: harness.page.id,
        body: "Body",
      }),
    ).rejects.toMatchObject({ code: "invalid_token", status: 401 });
    expect(
      await wikiFieldState(harness.database, { includeOperationKeys: true }),
    ).toEqual(before);
  },
);

it.each(["private", "anchored", "deleted", "revoked"])(
  "hides a %s page for every operation including unchanged text and stored replay",
  async (state) => {
    const harness = await setup();
    const root = await addAgentComment(harness);
    if (state === "private")
      await harness.database.execute(
        "UPDATE wiki_pages SET scope = 'private' WHERE id = $id;",
        { id: harness.page.id },
      );
    if (state === "anchored")
      await harness.database.execute(
        "INSERT INTO wiki_page_anchors VALUES ($id, 'department', 'beta');",
        { id: harness.page.id },
      );
    if (state === "deleted")
      await harness.service.delete(harness.actor, harness.page.id);
    if (state === "revoked")
      await harness.database.execute(
        "DELETE FROM department_members WHERE user_id = 'reader';",
      );
    const before = await wikiFieldState(harness.database, {
      includeOperationKeys: true,
    });
    const event = vi.fn();
    harness.dependencies.events.subscribe(event);
    for (const pageId of [harness.page.id, "missing"])
      await expect(
        harness.comments.read(COMMENT_READER, { pageId }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        status: 404,
        details: undefined,
      });
    const writes = [
      [
        "wiki.comment.add",
        { operationId: "new", pageId: harness.page.id, body: "Body" },
      ],
      [
        "wiki.comment.add",
        {
          operationId: "add",
          pageId: harness.page.id,
          body: "Original comment",
        },
      ],
      [
        "wiki.comment.edit",
        {
          operationId: "edit",
          commentId: root.commentId,
          body: "Original comment",
        },
      ],
      [
        "wiki.comment.edit",
        { operationId: "edit-new", commentId: root.commentId, body: "Changed" },
      ],
      [
        "wiki.comment.resolve",
        { operationId: "resolve", commentId: root.commentId, resolved: true },
      ],
      [
        "wiki.comment.delete",
        { operationId: "delete", commentId: root.commentId },
      ],
    ] as const;
    for (const [operation, input] of writes)
      await expect(
        harness.comments.apply(COMMENT_READER, operation, input),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        status: 404,
        details: undefined,
      });
    expect(
      await wikiFieldState(harness.database, { includeOperationKeys: true }),
    ).toEqual(before);
    expect(event).not.toHaveBeenCalled();
  },
);

it.each(["writer", "owner", "outsider"])(
  "forbids %s to edit another author's text, also when it is unchanged",
  async (userId) => {
    const harness = await setup();
    await harness.addUser("outsider", {
      departments: ["alpha"],
      capabilities: [],
    });
    const root = await addAgentComment(harness);
    const before = await wikiFieldState(harness.database, {
      includeOperationKeys: true,
    });
    for (const body of ["Changed", "Original comment"])
      await expect(
        harness.comments.apply(
          { userId, isAdmin: true, permissions: ["write"] },
          "wiki.comment.edit",
          { operationId: "forbidden", commentId: root.commentId, body },
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(
      await wikiFieldState(harness.database, { includeOperationKeys: true }),
    ).toEqual(before);
  },
);

it.each(["reader", "writer", "owner", "role-admin", "outsider"])(
  "uses persisted author, page owner and MCP admin rights for deletion by %s",
  async (userId) => {
    const harness = await setup();
    await harness.addUser("role-admin", { isAdmin: true, mode: "role" });
    await harness.addUser("outsider", {
      departments: ["alpha"],
      capabilities: [],
    });
    const root = await addAgentComment(harness);
    const before = await wikiFieldState(harness.database, {
      includeOperationKeys: true,
    });
    const identity = {
      userId,
      isAdmin: userId === "outsider",
      permissions: [],
    };
    const request = { operationId: "delete", commentId: root.commentId };
    if (userId === "outsider") {
      await expect(
        harness.comments.apply(identity, "wiki.comment.delete", request),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(
        await wikiFieldState(harness.database, { includeOperationKeys: true }),
      ).toEqual(before);
      return;
    }
    expect(
      await harness.comments.apply(identity, "wiki.comment.delete", request),
    ).toMatchObject({ result: { deletedComments: 1, changed: true } });
    expect(await harness.repository.comments.find(root.commentId)).toBeNull();
  },
);

it("refuses an administrator on another account's private page", async () => {
  const harness = await setup();
  const page = await harness.service.create(
    harness.actor,
    pageInput({ scope: "private" }),
  );
  const comment = await harness.service.addComment(harness.actor, page.id, {
    body: "Private",
    parentId: null,
    quote: null,
    quotePrefix: null,
    quoteSuffix: null,
  });
  await expect(
    harness.comments.apply(
      { userId: "owner", isAdmin: true, permissions: [] },
      "wiki.comment.delete",
      { operationId: "private", commentId: comment.id },
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("rejects missing comments, replies as parents, foreign and hidden parents, and invalid text atomically", async () => {
  const harness = await setup();
  const root = await addAgentComment(harness);
  const reply = await addAgentComment(harness, {
    operationId: "reply",
    parentId: root.commentId,
  });
  const foreign = await harness.service.create(harness.actor, pageInput());
  const hidden = await harness.service.create(
    harness.actor,
    pageInput({ scope: "private" }),
  );
  const plain = {
    body: "Other",
    parentId: null,
    quote: null,
    quotePrefix: null,
    quoteSuffix: null,
  };
  const parents = [
    reply.commentId,
    "missing",
    (await harness.service.addComment(harness.actor, foreign.id, plain)).id,
    (await harness.service.addComment(harness.actor, hidden.id, plain)).id,
  ];
  const before = await wikiFieldState(harness.database, {
    includeOperationKeys: true,
  });
  for (const parentId of parents)
    await expect(
      addAgentComment(harness, { operationId: "invalid-parent", parentId }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  for (const body of [" ", "😀".repeat(5001)]) {
    await expect(
      addAgentComment(harness, { operationId: "invalid-body", body }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      harness.comments.apply(COMMENT_READER, "wiki.comment.edit", {
        operationId: "invalid-edit",
        commentId: root.commentId,
        body,
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  }
  for (const [operation, parameters] of [
    ["wiki.comment.add", { pageId: "missing", body: "Body" }],
    ["wiki.comment.edit", { commentId: "missing", body: "Body" }],
    ["wiki.comment.resolve", { commentId: "missing", resolved: true }],
    ["wiki.comment.delete", { commentId: "missing" }],
  ] as const)
    await expect(
      harness.comments.apply(COMMENT_READER, operation, {
        operationId: "missing",
        ...parameters,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(
    await wikiFieldState(harness.database, { includeOperationKeys: true }),
  ).toEqual(before);
});

it.each(["wiki.comment.add", "wiki.comment.delete"] as const)(
  "rolls back %s and its mentions if recording the operation fails",
  async (operation) => {
    const harness = await setup();
    const root = await addAgentComment(harness, { body: "Root @writer" });
    await addAgentComment(harness, {
      operationId: "reply",
      parentId: root.commentId,
      body: "Reply @writer",
    });
    const before = await wikiFieldState(harness.database, {
      includeOperationKeys: true,
    });
    const failure = new Error("Synthetic storage failure");
    vi.spyOn(
      AgentOperationKeyRepository.prototype,
      "insert",
    ).mockRejectedValueOnce(failure);
    const event = vi.fn();
    harness.dependencies.events.subscribe(event);
    await expect(
      harness.comments.apply(
        COMMENT_READER,
        operation,
        operation === "wiki.comment.add"
          ? {
              operationId: "interrupted",
              pageId: harness.page.id,
              body: "New @writer",
            }
          : { operationId: "interrupted", commentId: root.commentId },
      ),
    ).rejects.toBe(failure);
    expect(
      await wikiFieldState(harness.database, { includeOperationKeys: true }),
    ).toEqual(before);
    expect(event).not.toHaveBeenCalled();
  },
);

it("propagates an unexpected read failure and rejects a response above the UTF-8 byte bound", async () => {
  const harness = await setup();
  const failure = new Error("Synthetic read failure");
  const listing = vi.spyOn(WikiCommentService.prototype, "list");
  listing.mockRejectedValueOnce(failure);
  await expect(
    harness.comments.read(COMMENT_READER, { pageId: harness.page.id }),
  ).rejects.toBe(failure);
  const root = await addAgentComment(harness);
  await harness.database.execute(
    "UPDATE wiki_comments SET body = $body WHERE id = $id;",
    {
      id: root.commentId,
      body: "😀".repeat(PAGES_AGENT_LIMITS.responseBytes / 4),
    },
  );
  await expect(
    harness.comments.read(COMMENT_READER, { pageId: harness.page.id }),
  ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE", status: 413 });
});

it("keeps the committed write when an event subscriber throws", async () => {
  const harness = await setup();
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  harness.dependencies.events.subscribe(() => {
    throw new Error("Synthetic subscriber failure");
  });
  const root = await addAgentComment(harness);
  expect(await harness.repository.comments.find(root.commentId)).toMatchObject({
    body: "Original comment",
  });
  expect(
    await new AgentOperationKeyRepository(harness.database).find(
      COMMENT_READER.userId,
      "add",
    ),
  ).not.toBeNull();
  expect(warning).toHaveBeenCalledExactlyOnceWith(
    "Pages event subscriber failed.",
  );
});
