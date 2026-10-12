import { expect, it, vi } from "vitest";

import { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";

import { a11Fetch, callA11Tool, useA11McpHarness } from "../helpers/a11-mcp";
import { pageInput } from "../helpers/wiki-harness";

const setup = useA11McpHarness();

it.each([
  ["set_wiki_page_title", { title: "New title" }],
  ["set_wiki_page_icon", { icon: "📘" }],
])(
  "changes %s with write rights and rejects readers atomically",
  async (name, fields) => {
    const harness = await setup();
    vi.stubGlobal("fetch", a11Fetch(harness));
    const page = await harness.service.create(
      harness.owner,
      pageInput({ projectId: "p1", scope: "project" }),
    );
    harness.configuration.token = harness.tokens.get("writer") ?? "";
    const input = {
      operationId: name,
      pageId: page.id,
      expectedRevision: 1,
      ...fields,
    };
    expect(await callA11Tool(harness.connection, name, input)).toMatchObject({
      changed: true,
      revision: 2,
    });
    const before = await harness.database.query(
      "SELECT COUNT(*) FROM project_activity;",
    );
    harness.configuration.token = harness.tokens.get("reader") ?? "";
    expect(
      await callA11Tool(harness.connection, name, {
        ...input,
        operationId: `denied-${name}`,
        expectedRevision: 2,
      }),
    ).toMatchObject({ code: "FORBIDDEN" });
    expect(
      await harness.database.query("SELECT COUNT(*) FROM project_activity;"),
    ).toEqual(before);
  },
);

it("moves a whole wiki subtree across scopes using management rights", async () => {
  const harness = await setup();
  vi.stubGlobal("fetch", a11Fetch(harness));
  const page = await harness.service.create(
    harness.owner,
    pageInput({ projectId: "p1", scope: "project" }),
  );
  const child = await harness.service.create(
    harness.owner,
    pageInput({ parentId: page.id }),
  );
  const input = {
    operationId: "private-move",
    pageId: page.id,
    expectedRevision: 1,
    projectId: null,
    scope: "private",
    parentId: null,
    beforeId: null,
  };
  harness.configuration.token = harness.tokens.get("writer") ?? "";
  expect(
    await callA11Tool(harness.connection, "move_wiki_page", input),
  ).toMatchObject({ code: "FORBIDDEN" });
  harness.configuration.token = harness.tokens.get("owner") ?? "";
  expect(
    await callA11Tool(harness.connection, "move_wiki_page", input),
  ).toMatchObject({ changed: true, projectId: null, revision: 1 });
  expect(
    await callA11Tool(harness.connection, "read_wiki_page", {
      pageId: child.id,
    }),
  ).toMatchObject({ scope: "private", projectId: null });
  harness.configuration.token = harness.tokens.get("writer") ?? "";
  expect(
    await callA11Tool(harness.connection, "read_wiki_page", {
      pageId: child.id,
    }),
  ).toMatchObject({ code: "NOT_FOUND" });
});

it("continues wiki lists without hidden counts and binds cursors to the current query", async () => {
  const harness = await setup();
  vi.stubGlobal("fetch", a11Fetch(harness));
  const root = await harness.service.create(
    harness.owner,
    pageInput({
      projectId: "p1",
      scope: "project",
      title: "Needle root",
      content: "# First\n## Second",
    }),
  );
  const child = await harness.service.create(
    harness.owner,
    pageInput({ parentId: root.id, title: "Needle child" }),
  );
  await harness.service.create(
    harness.owner,
    pageInput({ projectId: "p2", scope: "project", title: "Needle secret" }),
  );
  const firstComment = await harness.service.addComment(
    harness.owner,
    root.id,
    {
      body: "First comment",
      parentId: null,
      quote: null,
      quotePrefix: null,
      quoteSuffix: null,
    },
  );
  await harness.service.addComment(harness.owner, root.id, {
    body: "Second comment",
    parentId: null,
    quote: null,
    quotePrefix: null,
    quoteSuffix: null,
  });
  harness.configuration.token = harness.tokens.get("writer") ?? "";
  for (const [name, parameters, field] of [
    ["read_wiki_tree", { projectId: "p1" }, "nodes"],
    ["search_wiki", { text: "Needle" }, "results"],
    ["read_wiki_outline", { pageId: root.id }, "headings"],
    ["read_wiki_comments", { pageId: root.id }, "threads"],
  ] as const) {
    const first = await callA11Tool(harness.connection, name, {
      ...parameters,
      limit: 1,
    });
    expect(first).toMatchObject({
      total: 2,
      nextCursor: expect.any(String),
      [field]: [expect.any(Object)],
    });
    const second = await callA11Tool(harness.connection, name, {
      ...parameters,
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(second).toMatchObject({
      total: 2,
      nextCursor: null,
      [field]: [expect.any(Object)],
    });
    expect(second[field]).not.toEqual(first[field]);
    expect(JSON.stringify([first, second])).not.toContain("Needle secret");
    expect(
      await callA11Tool(harness.connection, name, {
        ...parameters,
        cursor: "invalid",
      }),
    ).toMatchObject({ code: "INVALID_REQUEST" });
  }
  const outline = await callA11Tool(harness.connection, "read_wiki_outline", {
    pageId: root.id,
    limit: 1,
  });
  expect(
    await callA11Tool(harness.connection, "read_wiki_outline", {
      pageId: child.id,
      cursor: outline.nextCursor,
    }),
  ).toMatchObject({ code: "INVALID_REQUEST" });
  const commentsPage = await callA11Tool(
    harness.connection,
    "read_wiki_comments",
    { pageId: root.id, limit: 1 },
  );
  const cursor: unknown = JSON.parse(
    Buffer.from(String(commentsPage.nextCursor), "base64url").toString("utf8"),
  );
  expect(cursor).toEqual({
    version: 1,
    context: expect.any(String),
    after: firstComment.id,
  });
  harness.configuration.token = harness.tokens.get("owner") ?? "";
  expect(
    await callA11Tool(harness.connection, "delete_wiki_comment", {
      operationId: "delete-cursor-boundary",
      commentId: firstComment.id,
      confirmation: "LÖSCHEN",
    }),
  ).toMatchObject({ changed: true });
  harness.configuration.token = harness.tokens.get("writer") ?? "";
  expect(
    await callA11Tool(harness.connection, "read_wiki_comments", {
      pageId: root.id,
      cursor: commentsPage.nextCursor,
    }),
  ).toMatchObject({ code: "INVALID_REQUEST" });
  expect(
    await callA11Tool(harness.connection, "read_wiki_comments", {
      pageId: root.id,
    }),
  ).toMatchObject({ total: 1 });
});

it("creates instance, private and project roots and subpages through MCP, and denies writers without rights", async () => {
  const harness = await setup();
  vi.stubGlobal("fetch", a11Fetch(harness));
  for (const scope of ["instance", "private", "project"]) {
    const input = {
      operationId: `root-${scope}`,
      projectId: scope === "project" ? "p1" : null,
      scope,
      parentId: null,
      title: scope,
      content: "# One\n## Two",
      icon: null,
      assetIds: [],
    };
    const root = await callA11Tool(
      harness.connection,
      "create_wiki_page",
      input,
    );
    expect(root.pageId).toEqual(expect.any(String));
    const child = await callA11Tool(harness.connection, "create_wiki_page", {
      ...input,
      operationId: `child-${scope}`,
      title: "Child",
      parentId: root.pageId,
    });
    expect(child.pageId).toEqual(expect.any(String));
    harness.configuration.token = harness.tokens.get("reader") ?? "";
    expect(
      await callA11Tool(harness.connection, "create_wiki_page", {
        ...input,
        operationId: `denied-${scope}`,
      }),
    ).toMatchObject({ code: "FORBIDDEN" });
    harness.configuration.token = harness.tokens.get("owner") ?? "";
  }
});

it("requires the language-specific confirmation, compares revisions, recursively trashes and replays without another event", async () => {
  const harness = await setup();
  vi.stubGlobal("fetch", a11Fetch(harness));
  const page = await harness.service.create(
    harness.owner,
    pageInput({ projectId: "p1", scope: "project", title: "Root" }),
  );
  const child = await harness.service.create(
    harness.owner,
    pageInput({ parentId: page.id, title: "Child" }),
  );
  const input = {
    operationId: "delete-root",
    pageId: page.id,
    expected_revision: 1,
  };
  expect(
    await callA11Tool(harness.connection, "delete_wiki_page", input),
  ).toMatchObject({ code: "CONFIRMATION_REQUIRED" });
  expect(
    await callA11Tool(harness.connection, "delete_wiki_page", {
      ...input,
      confirmation: "DELETE",
    }),
  ).toMatchObject({ code: "CONFIRMATION_REQUIRED" });
  expect(
    await callA11Tool(harness.connection, "delete_wiki_page", {
      ...input,
      expected_revision: 2,
      confirmation: "LÖSCHEN",
    }),
  ).toMatchObject({ code: "CONFLICT", details: { currentRevision: 1 } });
  harness.configuration.token = harness.tokens.get("reader") ?? "";
  expect(
    await callA11Tool(harness.connection, "delete_wiki_page", {
      ...input,
      confirmation: "LÖSCHEN",
    }),
  ).toMatchObject({ code: "FORBIDDEN" });
  harness.configuration.token = harness.tokens.get("owner") ?? "";
  const result = await callA11Tool(harness.connection, "delete_wiki_page", {
    ...input,
    confirmation: "LÖSCHEN",
  });
  expect(result).toMatchObject({
    recursive: true,
    affectedCount: 2,
    disposition: "trash",
  });
  expect(
    await callA11Tool(harness.connection, "delete_wiki_page", {
      ...input,
      confirmation: "LÖSCHEN",
    }),
  ).toEqual(result);
  expect(
    (await harness.repository.pages.findNode(child.id))?.deletedAt,
  ).not.toBeNull();
  expect(
    await callA11Tool(harness.connection, "read_wiki_page", {
      pageId: page.id,
    }),
  ).toMatchObject({ code: "NOT_FOUND" });
  await harness.service.restore(harness.owner, page.id);
  expect(
    await callA11Tool(harness.connection, "read_wiki_page", {
      pageId: child.id,
    }),
  ).toMatchObject({ id: child.id });
  await new UserSettingsRepository(harness.database).upsertLanguage(
    harness.owner.id,
    "en",
  );
  expect(
    await callA11Tool(harness.connection, "delete_wiki_page", {
      ...input,
      operationId: "english-delete",
      confirmation: "DELETE",
    }),
  ).toMatchObject({ affectedCount: 2 });
});

it("uses 1 MiB UTF-8 content, keeps stale saves atomic, and reads outlines and visible forward/back links", async () => {
  const harness = await setup();
  vi.stubGlobal("fetch", a11Fetch(harness));
  const target = await harness.service.create(
    harness.owner,
    pageInput({ projectId: "p1", scope: "project", title: "Target" }),
  );
  const secret = await harness.service.create(
    harness.owner,
    pageInput({ projectId: "p2", scope: "project", title: "Secret target" }),
  );
  const page = await harness.service.create(
    harness.owner,
    pageInput({
      projectId: "p1",
      scope: "project",
      title: "Source",
      content: `# Heading\n## Subheading\n[Target](page:${target.id})\n[Hidden](page:${secret.id})`,
    }),
  );
  harness.configuration.token = harness.tokens.get("writer") ?? "";
  expect(
    await callA11Tool(harness.connection, "read_wiki_outline", {
      pageId: page.id,
    }),
  ).toMatchObject({
    headings: [
      { level: 1, text: "Heading" },
      { level: 2, text: "Subheading" },
    ],
  });
  expect(
    await callA11Tool(harness.connection, "read_wiki_links", {
      pageId: page.id,
    }),
  ).toMatchObject({ outgoing: [{ id: target.id, title: "Target" }], total: 1 });
  expect(
    await callA11Tool(harness.connection, "read_wiki_links", {
      pageId: target.id,
    }),
  ).toMatchObject({ incoming: [{ id: page.id, title: "Source" }] });
  const input = {
    operationId: "large-save",
    pageId: page.id,
    expectedRevision: 1,
    content: "ä".repeat(524_288),
  };
  expect(
    await callA11Tool(harness.connection, "set_wiki_page_content", input),
  ).toMatchObject({ changed: true, revision: 2 });
  expect(
    await callA11Tool(harness.connection, "read_wiki_page", {
      pageId: page.id,
    }),
  ).toMatchObject({ content: input.content, revision: 2 });
  expect(
    await callA11Tool(harness.connection, "set_wiki_page_content", {
      ...input,
      operationId: "too-large",
      expectedRevision: 2,
      content: `${input.content}a`,
    }),
  ).toMatchObject({
    code: "PAYLOAD_TOO_LARGE",
    details: { constraint: "wikiContentBytes" },
  });
  expect(
    await callA11Tool(harness.connection, "set_wiki_page_title", {
      operationId: "stale",
      pageId: page.id,
      expectedRevision: 1,
      title: "Wrong",
    }),
  ).toMatchObject({ code: "CONFLICT", details: { currentRevision: 2 } });
  harness.configuration.token = harness.tokens.get("reader") ?? "";
  expect(
    await callA11Tool(harness.connection, "set_wiki_page_content", {
      ...input,
      operationId: "forbidden",
      expectedRevision: 2,
    }),
  ).toMatchObject({ code: "FORBIDDEN" });
  expect(
    await callA11Tool(harness.connection, "read_wiki_outline", {
      pageId: secret.id,
    }),
  ).toMatchObject({ code: "NOT_FOUND" });
  expect(
    await callA11Tool(harness.connection, "read_wiki_links", {
      pageId: secret.id,
    }),
  ).toMatchObject({ code: "NOT_FOUND" });
});

it("adds, edits, resolves and confirms comment deletion, enforcing ownership and project source marking", async () => {
  const harness = await setup();
  vi.stubGlobal("fetch", a11Fetch(harness));
  const page = await harness.service.create(
    harness.owner,
    pageInput({ projectId: "p1", scope: "project" }),
  );
  harness.configuration.token = harness.tokens.get("reader") ?? "";
  const comment = await callA11Tool(harness.connection, "add_wiki_comment", {
    operationId: "comment",
    pageId: page.id,
    body: "Comment",
  });
  expect(
    await callA11Tool(harness.connection, "edit_wiki_comment", {
      operationId: "edit",
      commentId: comment.commentId,
      body: "Edited",
    }),
  ).toMatchObject({ changed: true });
  expect(
    await callA11Tool(harness.connection, "resolve_wiki_comment", {
      operationId: "resolve",
      commentId: comment.commentId,
      resolved: true,
    }),
  ).toMatchObject({ changed: true });
  harness.configuration.token = harness.tokens.get("writer") ?? "";
  expect(
    await callA11Tool(harness.connection, "edit_wiki_comment", {
      operationId: "other-edit",
      commentId: comment.commentId,
      body: "Wrong",
    }),
  ).toMatchObject({ code: "FORBIDDEN" });
  expect(
    await callA11Tool(harness.connection, "delete_wiki_comment", {
      operationId: "other-delete",
      commentId: comment.commentId,
      confirmation: "LÖSCHEN",
    }),
  ).toMatchObject({ code: "FORBIDDEN" });
  harness.configuration.token = harness.tokens.get("reader") ?? "";
  expect(
    await callA11Tool(harness.connection, "delete_wiki_comment", {
      operationId: "delete",
      commentId: comment.commentId,
    }),
  ).toMatchObject({ code: "CONFIRMATION_REQUIRED" });
  expect(
    await callA11Tool(harness.connection, "delete_wiki_comment", {
      operationId: "delete",
      commentId: comment.commentId,
      confirmation: "LÖSCHEN",
    }),
  ).toMatchObject({ deletedComments: 1 });
  const activity = await callA11Tool(
    harness.connection,
    "read_project_activity",
    { projectId: "p1" },
  );
  expect(activity.entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        action: "wiki_comment_deleted",
        source: "mcp",
      }),
      expect.objectContaining({ action: "wiki_page_created", source: "ui" }),
    ]),
  );
});
