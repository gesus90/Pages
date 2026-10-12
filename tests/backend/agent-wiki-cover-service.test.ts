import { expect, it, vi } from "vitest";

import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import { WikiCoverService } from "@/backend/service/wiki/WikiCoverService";

import { pageInput } from "../helpers/wiki-harness";
import { IMPORT_IDENTITY } from "../helpers/wiki-import-apply";
import {
  persistedPage,
  useWikiFieldHarness,
  wikiFieldState,
} from "../helpers/wiki-fields";

import type { User } from "@/definition/User";
import type { WikiFieldHarness } from "../helpers/wiki-fields";

const setup = useWikiFieldHarness();

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const GIF = Buffer.from("GIF89a....");
const WEBP = Buffer.from("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ", "latin1");
const AUDIO = Buffer.from("OggS....");
const NOTE = Buffer.from("<script>alert(1)</script>");

async function* stream(content: Buffer): AsyncIterable<Uint8Array> {
  await Promise.resolve();
  yield content;
}

async function upload(
  harness: WikiFieldHarness,
  pageId: string,
  fileName: string,
  content: Buffer,
  uploader: User = harness.actor,
): Promise<string> {
  const attachment = await harness.service.uploadAttachment(uploader, pageId, {
    body: stream(content),
    contentLength: content.length,
    fileName,
  });
  return attachment.id;
}

async function readBack(
  harness: WikiFieldHarness,
  pageId: string,
): Promise<unknown> {
  const response = await harness.router.handle(IMPORT_IDENTITY, {
    operation: "wiki.page.read",
    parameters: { pageId },
  });
  return "cover" in response.result ? response.result.cover : undefined;
}

function setCover(
  harness: WikiFieldHarness,
  operationId: string,
  cover: unknown,
  pageId = harness.page.id,
): Promise<unknown> {
  return harness.fields.apply(IMPORT_IDENTITY, "wiki.page.setCover", {
    operationId,
    pageId,
    cover,
  });
}

it("sets, replaces and removes a cover without touching text, revision, versions or other pages", async () => {
  const harness = await setup();
  const other = await harness.service.create(
    harness.actor,
    pageInput({ title: "Other", scope: "project", projectId: "alpha" }),
  );
  const image = await upload(harness, harness.page.id, "banner.png", PNG);
  const untouched = await persistedPage(harness.database, other.id);
  const original = await persistedPage(harness.database, harness.page.id);
  const versions = await harness.database.query(
    "SELECT page_id, revision, title, content FROM wiki_page_versions ORDER BY page_id, revision;",
  );
  const events = vi.fn();
  harness.dependencies.events.subscribe(events);
  const steps = [
    { kind: "preset", preset: "sunrise" },
    { kind: "preset", preset: "ocean" },
    { kind: "attachment", attachmentId: image },
    { kind: "preset", preset: "slate" },
    null,
  ] as const;
  for (const [index, cover] of steps.entries()) {
    expect(await setCover(harness, `cover-${index}`, cover)).toEqual({
      apiVersion: "1",
      result: {
        pageId: harness.page.id,
        link: `/wiki/${harness.page.id}`,
        field: "cover",
        revision: 1,
        changed: true,
        cover,
      },
    });
    expect(await readBack(harness, harness.page.id)).toEqual(cover);
    expect(await persistedPage(harness.database, harness.page.id)).toEqual({
      ...original,
      cover:
        cover === null
          ? null
          : `${cover.kind}:${cover.kind === "preset" ? cover.preset : cover.attachmentId}`,
    });
  }
  expect(await persistedPage(harness.database, other.id)).toEqual(untouched);
  expect(
    await harness.database.query(
      "SELECT page_id, revision, title, content FROM wiki_page_versions ORDER BY page_id, revision;",
    ),
  ).toEqual(versions);
  expect(events).toHaveBeenCalledTimes(steps.length);
  expect(events).toHaveBeenCalledWith({
    type: "wiki.page.updated",
    id: harness.page.id,
  });
});

it.each([
  ["JPEG", "photo.jpg", JPEG],
  ["PNG", "photo.png", PNG],
  ["GIF", "photo.gif", GIF],
  ["WebP", "photo.webp", WEBP],
])("accepts a %s attachment of the page", async (_label, name, bytes) => {
  const harness = await setup();
  const attachmentId = await upload(harness, harness.page.id, name, bytes);
  const cover = { kind: "attachment", attachmentId };
  expect(await setCover(harness, "image", cover)).toMatchObject({
    result: { changed: true, cover },
  });
  expect(await readBack(harness, harness.page.id)).toEqual(cover);
});

it("takes no revision: a cover is set on a page that was saved since it was read", async () => {
  const harness = await setup();
  await harness.fields.apply(IMPORT_IDENTITY, "wiki.page.setContent", {
    operationId: "text",
    pageId: harness.page.id,
    expectedRevision: 1,
    content: "Saved meanwhile",
  });
  expect(
    await setCover(harness, "cover", { kind: "preset", preset: "forest" }),
  ).toMatchObject({ result: { revision: 2, changed: true } });
  expect(await persistedPage(harness.database, harness.page.id)).toMatchObject({
    content: "Saved meanwhile",
    cover: "preset:forest",
    revision: 2,
  });
});

it("resolves a Pages address and reports an unchanged cover without an event", async () => {
  const harness = await setup();
  const cover = { kind: "preset", preset: "dusk" };
  await setCover(harness, "first", cover);
  const before = await wikiFieldState(harness.database);
  const events = vi.fn();
  harness.dependencies.events.subscribe(events);
  expect(
    await setCover(
      harness,
      "same",
      { preset: "dusk", kind: "preset" },
      `https://pages.invalid/prefix/wiki/${harness.page.id}/#top`,
    ),
  ).toMatchObject({ result: { changed: false, cover } });
  expect(await wikiFieldState(harness.database)).toEqual(before);
  expect(events).not.toHaveBeenCalled();
  expect(await setCover(harness, "none", null)).toMatchObject({
    result: { changed: true, cover: null },
  });
  expect(await setCover(harness, "none-again", null)).toMatchObject({
    result: { changed: false, cover: null },
  });
});

it("replays the stored result, binds the operation ID to its input and keeps keys per operation", async () => {
  const harness = await setup();
  const cover = { kind: "preset", preset: "sand" };
  const first = await setCover(harness, "stable", cover);
  await setCover(harness, "later", { kind: "preset", preset: "ocean" });
  const before = await wikiFieldState(harness.database, {
    includeOperationKeys: true,
  });
  const events = vi.fn();
  harness.dependencies.events.subscribe(events);
  // The stored result comes back even though the cover has changed since.
  expect(await setCover(harness, "stable", cover)).toEqual(first);
  await expect(
    setCover(harness, "stable", { kind: "preset", preset: "ocean" }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(setCover(harness, "stable", null)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  await expect(
    harness.fields.apply(IMPORT_IDENTITY, "wiki.page.setIcon", {
      operationId: "stable",
      pageId: harness.page.id,
      expectedRevision: 1,
      icon: null,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    await wikiFieldState(harness.database, { includeOperationKeys: true }),
  ).toEqual(before);
  expect(events).not.toHaveBeenCalled();
});

it("serializes identical concurrent operations into one write", async () => {
  const harness = await setup();
  const cover = { kind: "preset", preset: "ocean" };
  const events = vi.fn();
  harness.dependencies.events.subscribe(events);
  const [first, second] = await Promise.all([
    setCover(harness, "parallel", cover),
    setCover(harness, "parallel", cover),
  ]);
  expect(first).toEqual(second);
  expect(events).toHaveBeenCalledOnce();
  expect(
    await harness.database.query("SELECT COUNT(*) FROM agent_operation_keys;"),
  ).toEqual([[1]]);
});

it("rejects every invalid cover with the same failure and changes nothing", async () => {
  const harness = await setup();
  const foreign = await harness.service.create(
    harness.actor,
    pageInput({ title: "Foreign", scope: "project", projectId: "alpha" }),
  );
  const hiddenPage = await harness.service.create(
    harness.owner,
    pageInput({ title: "Hidden", scope: "project", projectId: "beta" }),
  );
  const candidates = [
    { kind: "preset", preset: "aurora" },
    { kind: "attachment", attachmentId: "missing-attachment" },
    { kind: "attachment", attachmentId: " padded " },
    { kind: "attachment", attachmentId: "x".repeat(65) },
    {
      kind: "attachment",
      attachmentId: await upload(harness, foreign.id, "foreign.png", PNG),
    },
    {
      kind: "attachment",
      attachmentId: await upload(
        harness,
        hiddenPage.id,
        "hidden.png",
        PNG,
        harness.owner,
      ),
    },
    {
      kind: "attachment",
      attachmentId: await upload(harness, harness.page.id, "note.html", NOTE),
    },
    {
      kind: "attachment",
      attachmentId: await upload(harness, harness.page.id, "song.ogg", AUDIO),
    },
  ];
  const before = await wikiFieldState(harness.database, {
    includeOperationKeys: true,
  });
  const failures: unknown[] = [];
  for (const [index, cover] of candidates.entries())
    failures.push(
      await setCover(harness, `invalid-${index}`, cover).catch(
        (error: unknown) => error,
      ),
    );
  for (const failure of failures)
    expect(failure).toMatchObject({
      code: "INVALID_REQUEST",
      status: 400,
      details: undefined,
      message: "The agent API request was rejected.",
    });
  // Nothing tells a foreign, a wrong-type and a missing attachment apart.
  expect(new Set(failures.map((failure) => JSON.stringify(failure))).size).toBe(
    1,
  );
  expect(
    await wikiFieldState(harness.database, { includeOperationKeys: true }),
  ).toEqual(before);
});

it("treats a hidden page like a missing one", async () => {
  const harness = await setup();
  const hidden = await harness.service.create(
    harness.owner,
    pageInput({ scope: "project", projectId: "beta" }),
  );
  const before = await wikiFieldState(harness.database, {
    includeOperationKeys: true,
  });
  const failures: unknown[] = [];
  for (const pageId of [hidden.id, "missing"])
    failures.push(
      await setCover(
        harness,
        "unseen",
        { kind: "preset", preset: "slate" },
        pageId,
      ).catch((error: unknown) => error),
    );
  expect(failures).toEqual([
    expect.objectContaining({ code: "NOT_FOUND", status: 404 }),
    expect.objectContaining({ code: "NOT_FOUND", status: 404 }),
  ]);
  expect(
    await wikiFieldState(harness.database, { includeOperationKeys: true }),
  ).toEqual(before);
  expect(await persistedPage(harness.database, hidden.id)).toMatchObject({
    cover: null,
  });
});

it("refuses without the write right and stores nothing", async () => {
  const harness = await setup();
  await setCover(harness, "written", { kind: "preset", preset: "slate" });
  await harness.database.execute(
    "DELETE FROM role_permissions WHERE role_id = 'role-writer';",
  );
  const before = await wikiFieldState(harness.database, {
    includeOperationKeys: true,
  });
  for (const [operationId, pageId] of [
    ["written", harness.page.id],
    ["fresh", harness.page.id],
    ["missing", "missing"],
  ] as const)
    await expect(
      setCover(harness, operationId, null, pageId),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(
    await wikiFieldState(harness.database, { includeOperationKeys: true }),
  ).toEqual(before);
});

it("shows a stored result again only while its page is visible", async () => {
  const harness = await setup();
  const cover = { kind: "preset", preset: "forest" };
  await setCover(harness, "visible", cover);
  await harness.database.execute(
    "DELETE FROM department_members WHERE user_id = 'writer';",
  );
  await expect(setCover(harness, "visible", cover)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

it("rolls back the cover and the operation key on a persistence failure, then succeeds on retry", async () => {
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
  const cover = { kind: "preset", preset: "sunrise" };
  await expect(setCover(harness, "retry", cover)).rejects.toBe(failure);
  expect(
    await wikiFieldState(harness.database, { includeOperationKeys: true }),
  ).toEqual(before);
  expect(events).not.toHaveBeenCalled();
  expect(await setCover(harness, "retry", cover)).toMatchObject({
    result: { changed: true, cover },
  });
  expect(events).toHaveBeenCalledOnce();
});

it("writes through the cover service of the interface", async () => {
  const harness = await setup();
  const write = vi.spyOn(WikiCoverService.prototype, "setCover");
  await setCover(harness, "service", { kind: "preset", preset: "ocean" });
  expect(write).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ id: "writer" }),
    harness.page.id,
    "preset:ocean",
  );
  await setCover(harness, "service-none", null);
  expect(write).toHaveBeenLastCalledWith(
    expect.objectContaining({ id: "writer" }),
    harness.page.id,
    null,
  );
});
