import { readdir, rm, readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { AgentOperationKeyService } from "@/backend/service/agents/AgentOperationKeyService";
import { readAgentWikiCreate } from "@/backend/service/agents/AgentWikiCreateValidation";
import { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";
import { WikiFileStore } from "@/backend/storage/WikiFileStore";
import { WIKI_SETTING_DEFAULTS } from "@/definition/Wiki";
import { useMigratedDatabase } from "../helpers/test-database";
import { pageInput } from "../helpers/wiki-harness";
import {
  agentWriteFixture,
  bytes,
  createInput,
  PNG,
  PDF,
  WRITE_IDENTITY,
} from "../helpers/agent-writes";

describe("A9.6 binary assets and atomic wiki creation", () => {
  const getDatabase = useMigratedDatabase();
  const directories: string[] = [];
  afterEach(async () => {
    for (const directory of directories.splice(0))
      await rm(directory, { recursive: true, force: true });
    vi.useRealTimers();
  });
  async function fixture() {
    const result = await agentWriteFixture(getDatabase());
    directories.push(result.filesDirectory);
    return result;
  }

  it("routes page creation and binary upload preparation through the authenticated API", async () => {
    const run = await fixture();
    const credential = await run.personal.create("owner", "api-test", null);
    const created = await run.api.handle(credential.token, {
      operation: "wiki.page.create",
      parameters: createInput(),
    });
    expect(created).toMatchObject({
      result: { pageId: expect.any(String), assets: [] },
    });
    const prepared = await run.api.handle(credential.token, {
      operation: "assets.upload.prepare",
      parameters: { fileName: "image.png" },
    });
    expect(prepared).toMatchObject({
      result: { ticket: expect.any(String), header: "X-Pages-Upload-Ticket" },
    });
    expect(await run.database.query("SELECT title FROM wiki_pages;")).toEqual([
      ["Created"],
    ]);
  });

  it("uploads image and PDF bytes, links both, opens stable links and recovers a lost response without duplicate objects", async () => {
    const run = await fixture();
    const uploaded = [];
    for (const [fileName, content] of [
      ["image.png", PNG],
      ["paper.pdf", PDF],
    ] as const) {
      uploaded.push(
        await run.assets.upload(
          { fileName, contentLength: null, body: bytes(content) },
          async () => WRITE_IDENTITY,
        ),
      );
    }
    expect(uploaded).toMatchObject([
      {
        assetId: expect.any(String),
        link: expect.stringMatching(/^\/agent-assets\//),
        contentType: "image/png",
      },
      {
        assetId: expect.any(String),
        link: expect.stringMatching(/^\/agent-assets\//),
        contentType: "application/octet-stream",
      },
    ]);
    const input = createInput({
      assetIds: uploaded.map((asset) => asset.assetId),
      content: `![image](${uploaded[0]?.link})\n[PDF](${uploaded[1]?.link})`,
    });
    const seen: unknown[] = [];
    const unsubscribe = run.events.subscribe((event) => {
      seen.push(event);
    });
    const before = await run.database.query("SELECT COUNT(*) FROM wiki_pages;");
    const created = await run.create.create(run.owner, input);
    expect(await run.create.create(run.owner, input)).toEqual(created);
    expect(
      await run.database.query("SELECT COUNT(*) FROM wiki_pages;"),
    ).toEqual([[Number(before[0]?.[0]) + 1]]);
    expect(created.assets).toHaveLength(2);
    expect(seen).toEqual([
      { type: "wiki.page.created", id: created.pageId },
      ...uploaded.map((asset) => ({ type: "asset.linked", id: asset.assetId })),
    ]);
    for (const [index, asset] of uploaded.entries()) {
      const opened = await run.assets.open(run.other, asset.assetId);
      const chunks = [];
      for await (const chunk of opened.stream) chunks.push(chunk);
      expect(Buffer.concat(chunks)).toEqual(index === 0 ? PNG : PDF);
      expect(await run.assetRepository.find(asset.assetId)).toMatchObject({
        status: "linked",
        pageId: created.pageId,
      });
    }
    expect(
      (
        await run.repository.pages.findVisible(
          {
            userId: "owner",
            isAdmin: true,
            projectIds: ["p1"],
            departmentIds: [],
          },
          created.pageId,
        )
      )?.content,
    ).toBe(input.content);
    unsubscribe();
    await run.assets.runMaintenance();
    expect(
      await run.assetRepository.find(uploaded[0]?.assetId ?? ""),
    ).toMatchObject({ status: "linked" });
  });

  it("serializes simultaneous replays and rejects changed input without editing any page", async () => {
    const run = await fixture();
    const input = createInput();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => run.create.create(run.owner, input)),
    );
    expect(new Set(results.map((result) => result.pageId)).size).toBe(1);
    await expect(
      run.create.create(run.owner, { ...input, content: "Changed" }),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(
      await run.database.query("SELECT title, content FROM wiki_pages;"),
    ).toEqual([[input.title, input.content]]);
    await run.operationRepository.insert(run.owner.id, "foreign-operation", {
      operation: "other.operation",
      fingerprint: "wrong",
      resultJson: "{}",
    });
    await expect(
      new AgentOperationKeyService(run.operationRepository).replay(
        run.owner.id,
        createInput({ operationId: "foreign-operation" }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects foreign, absent, expired and already linked assets with no operations or pages", async () => {
    const run = await fixture();
    const upload = await run.assets.upload(
      { fileName: "image.png", contentLength: null, body: bytes(PNG) },
      async () => WRITE_IDENTITY,
    );
    await expect(
      run.create.create(run.other, createInput({ assetIds: [upload.assetId] })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await run.assetRepository.find(upload.assetId)).toMatchObject({
      status: "staged",
    });
    expect(
      await run.database.query("SELECT COUNT(*) FROM agent_operation_keys;"),
    ).toEqual([[0]]);
    await expect(
      run.create.create(run.owner, createInput({ assetIds: ["missing"] })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const staged = await run.assets.open(run.owner, upload.assetId);
    staged.stream.destroy();
    await expect(run.assets.open(run.other, upload.assetId)).rejects.toThrow(
      "page does not exist",
    );
    await run.create.create(
      run.owner,
      createInput({ assetIds: [upload.assetId] }),
    );
    await expect(
      run.create.create(
        run.owner,
        createInput({ operationId: "again", assetIds: [upload.assetId] }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const another = await run.assets.upload(
      { fileName: "paper.pdf", contentLength: null, body: bytes(PDF) },
      async () => WRITE_IDENTITY,
    );
    await run.database.execute(
      "UPDATE agent_assets SET expires_at = $now WHERE id = $id;",
      { now: Date.now(), id: another.assetId },
    );
    await expect(run.assets.open(run.owner, another.assetId)).rejects.toThrow(
      "page does not exist",
    );
    await expect(
      run.create.create(
        run.owner,
        createInput({ operationId: "expired", assetIds: [another.assetId] }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(run.assets.open(run.owner, "missing")).rejects.toThrow(
      "page does not exist",
    );
  });

  it("creates nothing without write permission, for invisible/private/wrong-project parents or beyond tree depth", async () => {
    const run = await fixture();
    const privatePage = await run.service.create(
      run.owner,
      pageInput({ scope: "private" }),
    );
    const otherProject = await run.service.create(
      run.owner,
      pageInput({ scope: "project", projectId: "p2" }),
    );
    for (const [actor, input, code] of [
      [run.reader, createInput(), "FORBIDDEN"],
      [run.owner, createInput({ projectId: "missing" }), "NOT_FOUND"],
      [run.other, createInput({ parentId: privatePage.id }), "NOT_FOUND"],
      [run.owner, createInput({ parentId: "missing" }), "NOT_FOUND"],
      [run.owner, createInput({ parentId: otherProject.id }), "NOT_FOUND"],
      [run.owner, createInput({ parentId: privatePage.id }), "NOT_FOUND"],
      [run.owner, createInput({ title: "" }), "INVALID_REQUEST"],
    ] as const)
      await expect(run.create.create(actor, input)).rejects.toMatchObject({
        code,
      });
    expect(
      await run.database.query("SELECT COUNT(*) FROM agent_operation_keys;"),
    ).toEqual([[0]]);
    expect(
      await run.database.query("SELECT COUNT(*) FROM wiki_pages;"),
    ).toEqual([[2]]);
    let parentId: string | null = null;
    for (let level = 0; level < 10; level += 1) {
      const page = await run.service.create(
        run.owner,
        pageInput({ scope: "project", projectId: "p1", parentId }),
      );
      parentId = page.id;
    }
    await expect(
      run.create.create(run.owner, createInput({ parentId })),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    const created = await run.create.create(
      run.owner,
      createInput({ parentId: otherProject.id, projectId: "p2" }),
    );
    expect(created.pageId).toBeTruthy();
  });

  it("enforces size while streaming regardless of length and leaves no row or partial file", async () => {
    const run = await fixture();
    await run.repository.settings.save({
      ...WIKI_SETTING_DEFAULTS,
      mediaLimitBytes: 16,
      fileLimitBytes: 20,
    });
    for (const [parts, contentLength] of [
      [[PNG, Buffer.alloc(4096)], null],
      [[Buffer.alloc(4096)], null],
      [[Buffer.alloc(21)], null],
      [[Buffer.alloc(20)], 21],
    ] as const)
      await expect(
        run.assets.upload(
          { fileName: "file", contentLength, body: bytes(...parts) },
          async () => WRITE_IDENTITY,
        ),
      ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    expect(
      await run.database.query("SELECT COUNT(*) FROM agent_assets;"),
    ).toEqual([[0]]);
    expect(await readdir(path.join(run.filesDirectory, "staging"))).toEqual([]);
  });

  it("expires after 24 hours, removes bytes, and retries a failed removal without reviving the asset", async () => {
    const run = await fixture();
    const upload = await run.assets.upload(
      { fileName: "image.png", contentLength: PNG.length, body: bytes(PNG) },
      async () => WRITE_IDENTITY,
    );
    const stored = await run.assetRepository.find(upload.assetId);
    expect(
      await readFile(
        path.join(run.filesDirectory, "staging", stored?.storageName ?? ""),
      ),
    ).toEqual(PNG);
    await run.assets.runMaintenance();
    expect(await run.assetRepository.stagedStorageNames()).toEqual([
      stored?.storageName,
    ]);
    expect(
      await readFile(
        path.join(run.filesDirectory, "staging", stored?.storageName ?? ""),
      ),
    ).toEqual(PNG);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(upload.expiresAt);
    const remove = vi
      .spyOn(run.staging, "remove")
      .mockRejectedValueOnce(new Error("disk unavailable"));
    await expect(run.assets.runMaintenance()).rejects.toThrow(
      "disk unavailable",
    );
    expect(await run.assetRepository.find(upload.assetId)).toMatchObject({
      status: "expired",
    });
    await expect(run.assets.open(run.owner, upload.assetId)).rejects.toThrow(
      "page does not exist",
    );
    await run.assets.runMaintenance();
    expect(remove).toHaveBeenCalledTimes(2);
    expect(await run.assetRepository.find(upload.assetId)).toBeNull();
    expect(await readdir(path.join(run.filesDirectory, "staging"))).toEqual([]);
  });

  it("rolls back page, attachment and operation rows and removes copied files when persistence fails", async () => {
    const run = await fixture();
    const upload = await run.assets.upload(
      { fileName: "image.png", contentLength: null, body: bytes(PNG) },
      async () => WRITE_IDENTITY,
    );
    const save = vi
      .spyOn(AgentOperationKeyService.prototype, "save")
      .mockRejectedValueOnce(new Error("storage failure"));
    await expect(
      run.create.create(run.owner, createInput({ assetIds: [upload.assetId] })),
    ).rejects.toThrow("storage failure");
    expect(save).toHaveBeenCalledOnce();
    for (const table of [
      "wiki_pages",
      "wiki_attachments",
      "agent_operation_keys",
    ])
      expect(
        await run.database.query(`SELECT COUNT(*) FROM ${table};`),
      ).toEqual([[0]]);
    expect(await run.assetRepository.find(upload.assetId)).toMatchObject({
      status: "staged",
    });
    expect(
      (await readdir(run.filesDirectory)).filter((name) => name !== "staging"),
    ).toEqual([]);
    const opened = await run.assets.open(run.owner, upload.assetId);
    opened.stream.destroy();
  });

  it("cleans interrupted uploads and rejected metadata, account changes and failed staging persistence", async () => {
    const run = await fixture();
    const file = {
      fileName: "image.png",
      contentLength: null,
      body: bytes(PNG),
    };
    await expect(
      run.assets.upload(file, async () => ({
        ...WRITE_IDENTITY,
        isAdmin: false,
        permissions: [],
      })),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(run.assets.validateFileName("../../safe.png")).toBe("safe.png");
    await expect(
      run.assets.upload(
        { ...file, fileName: "x".repeat(256) },
        async () => WRITE_IDENTITY,
      ),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      run.assets.upload({ ...file, body: bytes() }, async () => WRITE_IDENTITY),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    const changed = vi
      .fn()
      .mockResolvedValueOnce(WRITE_IDENTITY)
      .mockResolvedValueOnce({ ...WRITE_IDENTITY, userId: "other" });
    await expect(
      run.assets.upload({ ...file, body: bytes(PNG) }, changed),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const insert = vi
      .spyOn(run.assetRepository, "insert")
      .mockRejectedValueOnce(new Error("insert failed"));
    await expect(
      run.assets.upload(
        { ...file, body: bytes(PNG) },
        async () => WRITE_IDENTITY,
      ),
    ).rejects.toThrow("insert failed");
    expect(insert).toHaveBeenCalledOnce();
    async function* broken() {
      yield PNG;
      throw new Error("connection lost");
    }
    await expect(
      run.assets.upload(
        { ...file, body: broken() },
        async () => WRITE_IDENTITY,
      ),
    ).rejects.toThrow("connection lost");
    expect(await readdir(path.join(run.filesDirectory, "staging"))).toEqual([]);
    const copy = new WikiFileStore(path.join(run.filesDirectory, "copies"));
    await expect(run.staging.copyTo("missing", copy)).rejects.toThrow();
    expect(await readdir(path.join(run.filesDirectory, "copies"))).toEqual([]);
  });

  it("publishes after commit, shields committed results from subscribers and releases subscriptions", async () => {
    const publisher = new PagesEventPublisher();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const unsubscribe = publisher.subscribe(() => {
      throw new Error("subscriber failure");
    });
    publisher.publish({ type: "wiki.page.created", id: "id" });
    expect(warn).toHaveBeenCalledOnce();
    unsubscribe();
    publisher.publish({ type: "wiki.page.created", id: "id" });
    expect(warn).toHaveBeenCalledOnce();
    const run = await fixture();
    const committed: Promise<unknown>[] = [];
    run.events.subscribe(() => {
      committed.push(
        run.database.query("SELECT COUNT(*) FROM agent_operation_keys;"),
      );
    });
    await run.create.create(run.owner, createInput());
    expect(await Promise.all(committed)).toEqual([[[1]]]);
  });
});

describe("A9.6 explicit input validation", () => {
  it("requires all fields, rejects injected policy, duplicate assets and invalid types", () => {
    const valid = createInput();
    expect(readAgentWikiCreate({ ...valid })).toEqual(valid);
    for (const change of [
      { actor: {} },
      { operationId: "" },
      { operationId: " " },
      { operationId: 1 },
      { operationId: "x".repeat(201) },
      { projectId: null },
      { parentId: undefined },
      { title: 1 },
      { content: null },
      { icon: [] },
      { assetIds: null },
      { assetIds: Array.from({ length: 101 }, (_, index) => String(index)) },
      { assetIds: ["same", "same"] },
    ])
      expect(() => readAgentWikiCreate({ ...valid, ...change })).toThrow(
        AgentOperationError,
      );
  });
});
