import { expect, it, vi } from "vitest";

import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import { WikiConflictError } from "@/backend/error/WikiErrors";
import { WikiPageService } from "@/backend/service/wiki/WikiPageService";

import { pageInput } from "../helpers/wiki-harness";
import { IMPORT_IDENTITY } from "../helpers/wiki-import-apply";
import {
  persistedPage,
  useWikiFieldHarness,
  wikiFieldState,
} from "../helpers/wiki-fields";

const setup = useWikiFieldHarness();

it.each([
  ["wiki.page.setTitle", "title", "  New\ntitle  ", "New title"],
  [
    "wiki.page.setContent",
    "content",
    "\uFEFFNew\r\ntext\r",
    "\uFEFFNew\r\ntext\r",
  ],
  ["wiki.page.setIcon", "icon", " 🧭 ", "🧭"],
  ["wiki.page.setIcon", "icon", null, null],
] as const)(
  "changes only %s, keeps history and replays a canonical address without writing",
  async (operation, field, value, normalized) => {
    const harness = await setup();
    const untouched = await harness.service.create(
      harness.actor,
      pageInput({ title: "Other", scope: "project", projectId: "alpha" }),
    );
    const before = await persistedPage(harness.database, harness.page.id);
    const other = await persistedPage(harness.database, untouched.id);
    const events = vi.fn();
    const committed: Promise<unknown>[] = [];
    harness.dependencies.events.subscribe(events);
    harness.dependencies.events.subscribe(() => {
      committed.push(
        harness.database.query(
          "SELECT operation_id FROM agent_operation_keys;",
        ),
      );
    });
    const input = {
      operationId: "change",
      pageId: harness.page.id,
      expectedRevision: 1,
      [field]: value,
    };
    const response = await harness.fields.apply(
      IMPORT_IDENTITY,
      operation,
      input,
    );
    expect(response).toEqual({
      apiVersion: "1",
      result: {
        pageId: harness.page.id,
        link: `/wiki/${harness.page.id}`,
        field,
        revision: 2,
        changed: true,
      },
    });
    expect(await persistedPage(harness.database, harness.page.id)).toEqual({
      ...before,
      [field]: normalized,
      revision: 2,
      updated_at: expect.any(String),
    });
    expect(await persistedPage(harness.database, untouched.id)).toEqual(other);
    // JSON keeps a leading BOM inside its string; the SDK strips it from a scalar VARCHAR.
    expect(
      await harness.database.query(
        "SELECT revision, title, TO_JSON(content) FROM wiki_page_versions WHERE page_id = $id ORDER BY revision DESC;",
        { id: harness.page.id },
      ),
    ).toEqual([
      [
        2,
        field === "title" ? normalized : "Original",
        JSON.stringify(field === "content" ? normalized : harness.page.content),
      ],
      [1, "Original", JSON.stringify(harness.page.content)],
    ]);
    expect(events).toHaveBeenCalledExactlyOnceWith({
      type: "wiki.page.updated",
      id: harness.page.id,
    });
    expect(await Promise.all(committed)).toEqual([[["change"]]]);
    const state = await wikiFieldState(harness.database, {
      includeOperationKeys: true,
    });
    expect(
      await harness.fields.apply(IMPORT_IDENTITY, operation, {
        ...input,
        pageId: `https://pages.invalid/prefix/wiki/${harness.page.id}/#top`,
      }),
    ).toEqual(response);
    expect(
      await wikiFieldState(harness.database, { includeOperationKeys: true }),
    ).toEqual(state);
    expect(events).toHaveBeenCalledOnce();
  },
);

it.each([
  ["wiki.page.setTitle", "title", "Original"],
  ["wiki.page.setContent", "content", "Original\r\ntext\r"],
  ["wiki.page.setIcon", "icon", "📘"],
] as const)(
  "records an unchanged %s result without a revision, version or event",
  async (operation, field, value) => {
    const harness = await setup();
    const before = await wikiFieldState(harness.database);
    const events = vi.fn();
    harness.dependencies.events.subscribe(events);
    const input = {
      operationId: "unchanged",
      pageId: harness.page.id,
      expectedRevision: 1,
      [field]: value,
    };
    const response = await harness.fields.apply(
      IMPORT_IDENTITY,
      operation,
      input,
    );
    expect(response).toMatchObject({
      result: { field, revision: 1, changed: false },
    });
    expect(
      await harness.fields.apply(IMPORT_IDENTITY, operation, input),
    ).toEqual(response);
    expect(await wikiFieldState(harness.database)).toEqual(before);
    expect(
      await harness.database.query(
        "SELECT operation_id FROM agent_operation_keys;",
      ),
    ).toEqual([["unchanged"]]);
    expect(events).not.toHaveBeenCalled();
  },
);

it("keeps consecutive saves by the same writer as separate versions and permits restoration", async () => {
  const harness = await setup();
  for (const expectedRevision of [1, 2])
    await harness.fields.apply(IMPORT_IDENTITY, "wiki.page.setContent", {
      operationId: `save-${expectedRevision}`,
      pageId: harness.page.id,
      expectedRevision,
      content: `Text ${expectedRevision}`,
    });
  const versions = await harness.repository.versions.list(harness.page.id);
  expect(
    await harness.database.query(
      "SELECT revision, content FROM wiki_page_versions WHERE page_id = $id ORDER BY revision DESC;",
      { id: harness.page.id },
    ),
  ).toEqual([
    [3, "Text 2"],
    [2, "Text 1"],
    [1, harness.page.content],
  ]);
  const previous = versions.find((version) => version.revision === 2);
  if (!previous) throw new Error("Expected the first edit's version.");
  expect(
    await harness.service.restoreVersion(
      harness.actor,
      harness.page.id,
      previous.id,
    ),
  ).toMatchObject({ revision: 4, content: "Text 1" });
});

it("rolls back versions, page and operation key on persistence failure, then succeeds on retry", async () => {
  const harness = await setup();
  const before = await wikiFieldState(harness.database, {
    includeOperationKeys: true,
  });
  const events = vi.fn();
  harness.dependencies.events.subscribe(events);
  const failure = new Error("Operation storage unavailable");
  vi.spyOn(
    AgentOperationKeyRepository.prototype,
    "insert",
  ).mockRejectedValueOnce(failure);
  const input = {
    operationId: "retry",
    pageId: harness.page.id,
    expectedRevision: 1,
    content: "Changed",
  };
  await expect(
    harness.fields.apply(IMPORT_IDENTITY, "wiki.page.setContent", input),
  ).rejects.toBe(failure);
  expect(
    await wikiFieldState(harness.database, { includeOperationKeys: true }),
  ).toEqual(before);
  expect(events).not.toHaveBeenCalled();
  expect(
    await harness.fields.apply(IMPORT_IDENTITY, "wiki.page.setContent", input),
  ).toMatchObject({ result: { revision: 2, changed: true } });
  expect(events).toHaveBeenCalledOnce();
});

it("binds replay to the operation and input, rechecks visibility and isolates keys by user", async () => {
  const harness = await setup();
  const input = {
    operationId: "same-key",
    pageId: harness.page.id,
    expectedRevision: 1,
    title: "Changed",
  };
  await harness.fields.apply(IMPORT_IDENTITY, "wiki.page.setTitle", input);
  const before = await wikiFieldState(harness.database, {
    includeOperationKeys: true,
  });
  await expect(
    harness.fields.apply(IMPORT_IDENTITY, "wiki.page.setTitle", {
      ...input,
      title: "Different",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    harness.fields.apply(IMPORT_IDENTITY, "wiki.page.setContent", {
      operationId: input.operationId,
      pageId: harness.page.id,
      expectedRevision: 1,
      content: "Changed",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    await wikiFieldState(harness.database, { includeOperationKeys: true }),
  ).toEqual(before);
  expect(
    await harness.fields.apply(
      { userId: "owner", isAdmin: true, permissions: [] },
      "wiki.page.setTitle",
      { ...input, expectedRevision: 2 },
    ),
  ).toMatchObject({ result: { changed: false } });
  await harness.database.execute(
    "DELETE FROM department_members WHERE user_id = 'writer';",
  );
  await expect(
    harness.fields.apply(IMPORT_IDENTITY, "wiki.page.setTitle", input),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("serializes concurrent identical operations and rejects competing changes without lost text", async () => {
  const harness = await setup();
  const input = {
    operationId: "parallel",
    pageId: harness.page.id,
    expectedRevision: 1,
    content: "First",
  };
  const [first, second] = await Promise.all([
    harness.fields.apply(IMPORT_IDENTITY, "wiki.page.setContent", input),
    harness.fields.apply(IMPORT_IDENTITY, "wiki.page.setContent", input),
  ]);
  expect(first).toEqual(second);
  const competing = await Promise.allSettled(
    ["A", "B"].map((content) =>
      harness.fields.apply(IMPORT_IDENTITY, "wiki.page.setContent", {
        ...input,
        operationId: content,
        expectedRevision: 2,
        content,
      }),
    ),
  );
  expect(
    competing.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(competing.filter((result) => result.status === "rejected")).toEqual([
    {
      status: "rejected",
      reason: expect.objectContaining({ code: "CONFLICT" }),
    },
  ]);
  expect(await harness.repository.versions.list(harness.page.id)).toHaveLength(
    3,
  );
  expect(
    await harness.database.query("SELECT COUNT(*) FROM agent_operation_keys;"),
  ).toEqual([[2]]);
});

it("translates a conflict detected by the page service without persisting an operation", async () => {
  const harness = await setup();
  const before = await wikiFieldState(harness.database, {
    includeOperationKeys: true,
  });
  vi.spyOn(WikiPageService.prototype, "update").mockRejectedValueOnce(
    new WikiConflictError(harness.page),
  );
  await expect(
    harness.fields.apply(IMPORT_IDENTITY, "wiki.page.setTitle", {
      operationId: "conflict",
      pageId: harness.page.id,
      expectedRevision: 1,
      title: "Changed",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    await wikiFieldState(harness.database, { includeOperationKeys: true }),
  ).toEqual(before);
});

it.each(["missing", "inactive", "password"])(
  "rejects a %s account inside the transaction",
  async (kind) => {
    const harness = await setup();
    const before = await wikiFieldState(harness.database, {
      includeOperationKeys: true,
    });
    if (kind === "inactive")
      await harness.database.execute(
        "UPDATE users SET is_active = 0 WHERE id = 'writer';",
      );
    if (kind === "password")
      await harness.database.execute(
        "UPDATE users SET must_change_password = 1 WHERE id = 'writer';",
      );
    await expect(
      harness.fields.apply(
        {
          ...IMPORT_IDENTITY,
          userId: kind === "missing" ? "missing" : "writer",
        },
        "wiki.page.setTitle",
        {
          operationId: "auth",
          pageId: harness.page.id,
          expectedRevision: 1,
          title: "Changed",
        },
      ),
    ).rejects.toMatchObject({ code: "invalid_token", status: 401 });
    expect(
      await wikiFieldState(harness.database, { includeOperationKeys: true }),
    ).toEqual(before);
  },
);

it("checks persisted write rights before replay, page existence, revision and field semantics", async () => {
  const harness = await setup();
  const input = {
    operationId: "write",
    pageId: harness.page.id,
    expectedRevision: 1,
    title: "Changed",
  };
  await harness.fields.apply(IMPORT_IDENTITY, "wiki.page.setTitle", input);
  await harness.database.execute(
    "DELETE FROM role_permissions WHERE role_id = 'role-writer';",
  );
  const before = await wikiFieldState(harness.database, {
    includeOperationKeys: true,
  });
  for (const pageId of [harness.page.id, "missing"])
    await expect(
      harness.fields.apply(
        { ...IMPORT_IDENTITY, isAdmin: true },
        "wiki.page.setTitle",
        { ...input, pageId, title: "" },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    harness.fields.apply(IMPORT_IDENTITY, "wiki.page.setTitle", input),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(
    await wikiFieldState(harness.database, { includeOperationKeys: true }),
  ).toEqual(before);
});

it("checks visibility before stale revisions and stale revisions before invalid fields", async () => {
  const harness = await setup();
  const hidden = await harness.service.create(
    harness.owner,
    pageInput({ scope: "project", projectId: "beta" }),
  );
  const before = await wikiFieldState(harness.database, {
    includeOperationKeys: true,
  });
  for (const pageId of [hidden.id, "missing"])
    await expect(
      harness.fields.apply(IMPORT_IDENTITY, "wiki.page.setTitle", {
        operationId: "hidden",
        pageId,
        expectedRevision: 2,
        title: "",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    harness.fields.apply(IMPORT_IDENTITY, "wiki.page.setTitle", {
      operationId: "stale",
      pageId: harness.page.id,
      expectedRevision: 2,
      title: "",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    await wikiFieldState(harness.database, { includeOperationKeys: true }),
  ).toEqual(before);
});

it.each([
  ["wiki.page.setTitle", "title", ""],
  ["wiki.page.setTitle", "title", "x".repeat(201)],
  ["wiki.page.setContent", "content", "x".repeat(1_048_577)],
  ["wiki.page.setIcon", "icon", "invalid"],
] as const)(
  "rejects invalid %s values without changing the wiki",
  async (operation, field, value) => {
    const harness = await setup();
    const before = await wikiFieldState(harness.database, {
      includeOperationKeys: true,
    });
    await expect(
      harness.fields.apply(IMPORT_IDENTITY, operation, {
        operationId: "invalid",
        pageId: harness.page.id,
        expectedRevision: 1,
        [field]: value,
      }),
    ).rejects.toMatchObject({
      code:
        operation === "wiki.page.setContent"
          ? "PAYLOAD_TOO_LARGE"
          : "INVALID_REQUEST",
    });
    expect(
      await wikiFieldState(harness.database, { includeOperationKeys: true }),
    ).toEqual(before);
  },
);
