import { expect, it, vi } from "vitest";

import {
  a11Fetch,
  a11ToolResult,
  callA11Tool,
  useA11McpHarness,
} from "../helpers/a11-mcp";
import { pageInput } from "../helpers/wiki-harness";

const setup = useA11McpHarness();

type Harness = Awaited<ReturnType<typeof setup>>;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const NOTE = Buffer.from("<script>alert(1)</script>");
const PRESETS = ["sunrise", "ocean", "forest", "dusk", "slate", "sand"];

async function* stream(content: Buffer): AsyncIterable<Uint8Array> {
  await Promise.resolve();
  yield content;
}

async function start(): Promise<Harness> {
  const harness = await setup();
  vi.stubGlobal("fetch", a11Fetch(harness));
  harness.configuration.token = harness.tokens.get("writer") ?? "";
  return harness;
}

function as(harness: Harness, user: string): void {
  harness.configuration.token = harness.tokens.get(user) ?? "";
}

function call(
  harness: Harness,
  name: string,
  parameters: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return callA11Tool(harness.connection, name, parameters);
}

async function createPage(
  harness: Harness,
  fields: Record<string, unknown> = {},
): Promise<string> {
  const created = await call(harness, "create_wiki_page", {
    operationId: `create-${String(Math.random())}`,
    projectId: "p1",
    parentId: null,
    title: "Visual page",
    content: "# Body",
    icon: null,
    assetIds: [],
    ...fields,
  });
  if (typeof created.pageId !== "string")
    throw new Error("Expected a created page.");
  return created.pageId;
}

async function attach(
  harness: Harness,
  pageId: string,
  fileName: string,
  content: Buffer,
): Promise<string> {
  const attachment = await harness.service.uploadAttachment(
    harness.writer,
    pageId,
    { body: stream(content), contentLength: content.length, fileName },
  );
  return attachment.id;
}

async function versionCount(harness: Harness, pageId: string): Promise<number> {
  const rows = await harness.database.query(
    "SELECT COUNT(*) FROM wiki_page_versions WHERE page_id = $id;",
    { id: pageId },
  );
  return Number(rows[0]?.[0]);
}

it("offers set_wiki_page_cover with its documented schema and annotations", async () => {
  const harness = await start();
  const listed = await harness.connection.request("tools/list");
  const tools: unknown = (listed?.result as { tools?: unknown } | undefined)
    ?.tools;
  if (!Array.isArray(tools)) throw new Error("Expected a tool list.");
  const names = tools.map((tool: { name: string }) => tool.name);
  expect(names).toEqual(
    expect.arrayContaining([
      "read_wiki_page",
      "create_wiki_page",
      "set_wiki_page_icon",
      "set_wiki_page_cover",
    ]),
  );
  const cover = tools.find(
    (tool: { name: string }) => tool.name === "set_wiki_page_cover",
  );
  expect(cover).toMatchObject({
    name: "set_wiki_page_cover",
    title: "Set wiki page cover",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["operationId", "pageId", "cover"],
      properties: {
        operationId: { type: "string", minLength: 1, maxLength: 200 },
        pageId: { type: "string", minLength: 1, maxLength: 200 },
        cover: {
          type: ["object", "null"],
          additionalProperties: false,
          required: ["kind"],
          properties: {
            kind: { type: "string", enum: ["preset", "attachment"] },
            preset: { type: "string", enum: PRESETS },
            attachmentId: { type: "string", minLength: 1, maxLength: 64 },
          },
        },
      },
    },
  });
  expect(cover.description).toContain(
    "sunrise, ocean, forest, dusk, slate or sand",
  );
  expect(cover.description).toContain("JPEG, PNG, GIF or WebP");
  expect(cover.inputSchema.properties).not.toHaveProperty("expectedRevision");
  const reader = tools.find(
    (tool: { name: string }) => tool.name === "read_wiki_page",
  );
  expect(reader.description).toContain("icon");
  expect(reader.description).toContain("cover");
});

it("reads the icon back after creating, changing and removing it, with the stored revision", async () => {
  const harness = await start();
  const pageId = await createPage(harness, { icon: "📘" });
  expect(await call(harness, "read_wiki_page", { pageId })).toMatchObject({
    id: pageId,
    icon: "📘",
    cover: null,
    revision: 1,
  });
  const change = {
    operationId: "icon-change",
    pageId,
    expectedRevision: 1,
    icon: "🧭",
  };
  const changed = await call(harness, "set_wiki_page_icon", change);
  expect(changed).toMatchObject({ field: "icon", revision: 2, changed: true });
  expect(await call(harness, "read_wiki_page", { pageId })).toMatchObject({
    icon: "🧭",
    revision: 2,
  });
  // A repeated operation returns the stored result and writes nothing.
  expect(await call(harness, "set_wiki_page_icon", change)).toEqual(changed);
  expect(await call(harness, "read_wiki_page", { pageId })).toMatchObject({
    icon: "🧭",
    revision: 2,
  });
  expect(
    await call(harness, "set_wiki_page_icon", { ...change, icon: "🚀" }),
  ).toMatchObject({ code: "CONFLICT" });
  expect(
    await call(harness, "set_wiki_page_icon", {
      operationId: "icon-remove",
      pageId,
      expectedRevision: 2,
      icon: null,
    }),
  ).toMatchObject({ revision: 3, changed: true });
  expect(await call(harness, "read_wiki_page", { pageId })).toMatchObject({
    icon: null,
    revision: 3,
    cover: null,
  });
});

it("keeps the icon and the revision when a change is stale, invalid or not permitted", async () => {
  const harness = await start();
  const pageId = await createPage(harness, { icon: "📘" });
  const base = { pageId, expectedRevision: 1, icon: "🧭" };
  expect(
    await call(harness, "set_wiki_page_icon", {
      ...base,
      operationId: "stale",
      expectedRevision: 5,
    }),
  ).toMatchObject({ code: "CONFLICT", details: { currentRevision: 1 } });
  expect(
    await call(harness, "set_wiki_page_icon", {
      ...base,
      operationId: "invalid",
      icon: "not an emoji",
    }),
  ).toMatchObject({ code: "INVALID_REQUEST" });
  as(harness, "reader");
  expect(
    await call(harness, "set_wiki_page_icon", { ...base, operationId: "read" }),
  ).toMatchObject({ code: "FORBIDDEN" });
  expect(await call(harness, "read_wiki_page", { pageId })).toMatchObject({
    icon: "📘",
    revision: 1,
  });
});

it("sets, changes and removes a cover through MCP and reads each state back without a new revision", async () => {
  const harness = await start();
  const pageId = await createPage(harness, { icon: "📘" });
  const imageId = await attach(harness, pageId, "banner.png", PNG);
  const before = await call(harness, "read_wiki_page", { pageId });
  expect(before).toMatchObject({ cover: null, icon: "📘", revision: 1 });
  const versions = await versionCount(harness, pageId);
  const updatedAt = await harness.database.query(
    "SELECT updated_at FROM wiki_pages WHERE id = $id;",
    { id: pageId },
  );
  const steps = [
    ...PRESETS.map((preset) => ({ kind: "preset", preset })),
    { kind: "attachment", attachmentId: imageId },
    { kind: "preset", preset: "ocean" },
    null,
  ];
  for (const [index, cover] of steps.entries()) {
    const result = await call(harness, "set_wiki_page_cover", {
      operationId: `cover-${index}`,
      pageId: `https://pages.invalid/wiki/${pageId}`,
      cover,
    });
    expect(result).toEqual({
      pageId,
      link: `/wiki/${pageId}`,
      field: "cover",
      revision: 1,
      changed: true,
      cover,
    });
    expect(await call(harness, "read_wiki_page", { pageId })).toEqual({
      ...before,
      cover,
    });
  }
  expect(await versionCount(harness, pageId)).toBe(versions);
  expect(
    await harness.database.query(
      "SELECT updated_at FROM wiki_pages WHERE id = $id;",
      { id: pageId },
    ),
  ).toEqual(updatedAt);
});

it("repeats a cover operation with the stored result and reports reused IDs with other input as a conflict", async () => {
  const harness = await start();
  const pageId = await createPage(harness);
  const input = {
    operationId: "cover-once",
    pageId,
    cover: { kind: "preset", preset: "forest" },
  };
  const first = await call(harness, "set_wiki_page_cover", input);
  expect(first).toMatchObject({ changed: true });
  await call(harness, "set_wiki_page_cover", {
    operationId: "cover-later",
    pageId,
    cover: null,
  });
  expect(await call(harness, "set_wiki_page_cover", input)).toEqual(first);
  expect(await call(harness, "read_wiki_page", { pageId })).toMatchObject({
    cover: null,
  });
  for (const cover of [{ kind: "preset", preset: "dusk" }, null])
    expect(
      await call(harness, "set_wiki_page_cover", { ...input, cover }),
    ).toMatchObject({ code: "CONFLICT" });
});

it("rejects unknown presets, other attachment types and foreign attachments with one stable error", async () => {
  const harness = await start();
  const pageId = await createPage(harness);
  const otherId = await createPage(harness, { title: "Other page" });
  const note = await attach(harness, pageId, "note.html", NOTE);
  const foreign = await attach(harness, otherId, "other.png", PNG);
  const accepted = await call(harness, "set_wiki_page_cover", {
    operationId: "accepted",
    pageId,
    cover: { kind: "preset", preset: "sand" },
  });
  const rejected = [
    { kind: "preset", preset: "aurora" },
    { kind: "attachment", attachmentId: note },
    { kind: "attachment", attachmentId: foreign },
    { kind: "attachment", attachmentId: "unknown-attachment" },
    { kind: "attachment" },
    { kind: "gradient", preset: "ocean" },
    "preset:ocean",
  ];
  const messages = [];
  for (const [index, cover] of rejected.entries()) {
    const message = await harness.connection.request("tools/call", {
      name: "set_wiki_page_cover",
      arguments: { operationId: `rejected-${index}`, pageId, cover },
    });
    expect(a11ToolResult(message)).toEqual({ code: "INVALID_REQUEST" });
    messages.push(
      JSON.stringify(
        (message?.result as { content: unknown } | undefined)?.content,
      ),
    );
  }
  expect(new Set(messages)).toEqual(new Set([messages[0]]));
  expect(await call(harness, "read_wiki_page", { pageId })).toMatchObject({
    cover: { kind: "preset", preset: "sand" },
  });
  expect(
    await call(harness, "set_wiki_page_cover", {
      operationId: "accepted",
      pageId,
      cover: { kind: "preset", preset: "sand" },
    }),
  ).toEqual(accepted);
});

it("checks current rights on each call and hides pages the account cannot see", async () => {
  const harness = await start();
  const pageId = await createPage(harness);
  const cover = { kind: "preset", preset: "slate" };
  as(harness, "reader");
  expect(
    await call(harness, "set_wiki_page_cover", {
      operationId: "reader",
      pageId,
      cover,
    }),
  ).toMatchObject({ code: "FORBIDDEN" });
  expect(await call(harness, "read_wiki_page", { pageId })).toMatchObject({
    cover: null,
  });
  as(harness, "hidden");
  for (const operation of ["hidden", "missing"])
    expect(
      await call(harness, "set_wiki_page_cover", {
        operationId: operation,
        pageId: operation === "hidden" ? pageId : "missing",
        cover,
      }),
    ).toEqual({ code: "NOT_FOUND", message: "Not found or no access." });
  as(harness, "writer");
  await call(harness, "set_wiki_page_cover", {
    operationId: "writer",
    pageId,
    cover,
  });
  as(harness, "hidden");
  expect(await call(harness, "read_wiki_page", { pageId })).toEqual({
    code: "NOT_FOUND",
    message: "Not found or no access.",
  });
  as(harness, "reader");
  expect(await call(harness, "read_wiki_page", { pageId })).toMatchObject({
    cover,
  });
});

it("reads the icon and cover of a page that exists only for its owner as not found for others", async () => {
  const harness = await start();
  const page = await harness.service.create(
    harness.owner,
    pageInput({ scope: "private", projectId: null, icon: "🔒" }),
  );
  as(harness, "owner");
  expect(
    await call(harness, "set_wiki_page_cover", {
      operationId: "private",
      pageId: page.id,
      cover: { kind: "preset", preset: "dusk" },
    }),
  ).toMatchObject({ changed: true });
  expect(
    await call(harness, "read_wiki_page", { pageId: page.id }),
  ).toMatchObject({
    icon: "🔒",
    cover: { kind: "preset", preset: "dusk" },
  });
  as(harness, "writer");
  expect(await call(harness, "read_wiki_page", { pageId: page.id })).toEqual({
    code: "NOT_FOUND",
    message: "Not found or no access.",
  });
});
