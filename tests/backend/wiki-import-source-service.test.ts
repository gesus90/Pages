import { readdir } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { AgentImportRepository } from "@/backend/database/repositories/agents/AgentImportRepository";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { WikiValidationError } from "@/backend/error/WikiErrors";
import { AgentWikiCreateTransaction } from "@/backend/service/agents/AgentWikiCreateTransaction";
import {
  readWikiImportParents,
  resolveWikiImportContext,
} from "@/backend/service/agents/WikiImportContext";
import { wikiImportPackage } from "@/backend/service/agents/WikiImportPackage";
import { WikiImportSourceService } from "@/backend/service/agents/WikiImportSourceService";

import { bytes, PNG } from "../helpers/agent-writes";
import { pageInput } from "../helpers/wiki-harness";
import { importPlan, importRequest } from "../helpers/wiki-import";
import {
  appliedImport,
  confirmedImport,
  IMPORT_IDENTITY,
  useWikiImportApplyHarness,
} from "../helpers/wiki-import-apply";

import type { WikiImportRun } from "@/backend/service/agents/WikiImportSourceService";
import type { WikiImportApplyHarness } from "../helpers/wiki-import-apply";

async function prepare(
  harness: WikiImportApplyHarness,
  input = importRequest(),
) {
  const plan = importPlan(await harness.planner.plan(harness.actor, input));
  const parents = await harness.database.transaction(async (transaction) =>
    readWikiImportParents(
      await resolveWikiImportContext(transaction, "writer", "alpha"),
      input.parentId,
    ),
  );
  const run: WikiImportRun = {
    id: "run",
    userId: "writer",
    projectId: "alpha",
    snapshot: { plan, parents },
  };
  await harness.mappings.insertRun({
    ...run,
    status: "running",
    snapshotJson: JSON.stringify(run.snapshot),
  });
  const source = wikiImportPackage(
    {
      ...input,
      operationId: "import",
      fingerprint: plan.fingerprint,
      assets: [],
    },
    plan,
  )[0];
  if (!source) throw new Error("Expected a package source.");
  return {
    run,
    source,
    input: {
      ...input,
      operationId: "import",
      fingerprint: plan.fingerprint,
      assets: [],
    },
    worker: new WikiImportSourceService(harness.dependencies),
  };
}

describe("source authorization and immutable outcomes", () => {
  const setup = useWikiImportApplyHarness();

  it.each(["write", "credential", "unavailable"])(
    "records a %s failure and replays it unchanged",
    async (cause) => {
      const harness = await setup();
      const { run, source, input, worker } = await prepare(harness);
      if (cause === "write")
        await harness.database.execute(
          "DELETE FROM role_permissions WHERE role_id = 'role-writer';",
        );
      const verify = async () => {
        if (cause === "unavailable")
          throw new McpAuthorizationError("unavailable", 503);
        return {
          ...IMPORT_IDENTITY,
          userId: cause === "credential" ? "other" : "writer",
        };
      };
      await worker.apply(run, source, input, verify);
      const item = await harness.mappings.findItem(run.id, source.sourceKey);
      expect(item).toMatchObject({
        action: "failed",
        pageId: null,
        assets: [],
        errorCode: {
          write: "FORBIDDEN",
          credential: "AUTH_INVALID",
          unavailable: "AUTH_UNAVAILABLE",
        }[cause],
      });
      await worker.apply(run, source, input, verify);
      expect(await harness.mappings.findItem(run.id, source.sourceKey)).toEqual(
        item,
      );
      expect(
        await harness.database.query("SELECT id FROM wiki_pages;"),
      ).toEqual([]);
    },
  );

  it("stops writing after persisted rights are revoked between sources", async () => {
    const harness = await setup();
    const input = await confirmedImport(
      harness,
      importRequest([
        { sourceKey: "a.md", content: "A" },
        { sourceKey: "b.md", content: "B" },
      ]),
    );
    let calls = 0;
    const verify = async () => {
      calls++;
      if (calls === 2)
        await harness.database.execute(
          "DELETE FROM role_permissions WHERE role_id = 'role-writer';",
        );
      return IMPORT_IDENTITY;
    };
    expect(
      appliedImport(
        await harness.imports.apply(IMPORT_IDENTITY, input, verify),
      ),
    ).toMatchObject({
      status: "partial",
      counts: { created: 1, failed: 1 },
      items: [
        { action: "created" },
        { action: "failed", errorCode: "FORBIDDEN" },
      ],
    });
    expect(
      await harness.database.query("SELECT COUNT(*) FROM wiki_pages;"),
    ).toEqual([[1]]);
  });

  it("does not reinterpret a committed failure when a competing worker resumes it", async () => {
    const harness = await setup();
    const { run, source, input, worker } = await prepare(harness);
    vi.spyOn(
      AgentWikiCreateTransaction.prototype,
      "create",
    ).mockRejectedValueOnce(new WikiValidationError("invalidParent"));
    await worker.apply(run, source, input, async () => IMPORT_IDENTITY);
    const failed = await harness.mappings.findItem(run.id, source.sourceKey);
    await worker.apply(run, source, input, async () => IMPORT_IDENTITY);
    expect(await harness.mappings.findItem(run.id, source.sourceKey)).toEqual(
      failed,
    );
    expect(failed).toMatchObject({
      action: "failed",
      errorCode: "INVALID_REQUEST",
    });
  });

  it("keeps an existing outcome immutable when its returned page becomes inaccessible", async () => {
    const harness = await setup();
    const { run, source, input, worker } = await prepare(harness);
    await worker.apply(run, source, input, async () => IMPORT_IDENTITY);
    const previous = await harness.mappings.findItem(run.id, source.sourceKey);
    await harness.database.execute("DELETE FROM wiki_pages;");
    await worker.apply(run, source, input, async () => IMPORT_IDENTITY);
    expect(await harness.mappings.findItem(run.id, source.sourceKey)).toEqual(
      previous,
    );
    expect(
      appliedImport(
        await harness.imports.apply(
          IMPORT_IDENTITY,
          await confirmedImport(harness),
          async () => IMPORT_IDENTITY,
        ),
      ),
    ).toMatchObject({
      status: "partial",
      items: [{ action: "failed", errorCode: "NOT_FOUND" }],
    });
  });

  it("detects an existing ancestor revision changing after the snapshot", async () => {
    const harness = await setup();
    const parent = await harness.service.create(
      harness.owner,
      pageInput({ scope: "project", projectId: "alpha", title: "Parent" }),
    );
    const { run, source, input, worker } = await prepare(
      harness,
      importRequest(undefined, { parentId: parent.id }),
    );
    await harness.database.execute(
      "UPDATE wiki_pages SET revision = revision + 1 WHERE id = $id;",
      { id: parent.id },
    );
    await worker.apply(run, source, input, async () => IMPORT_IDENTITY);
    expect(
      await harness.mappings.findItem(run.id, source.sourceKey),
    ).toMatchObject({ action: "conflict", errorCode: "CONFLICT" });
  });
});

describe("source creation rollback and live collisions", () => {
  const setup = useWikiImportApplyHarness();

  it("detects a visible title created after planning and rejects a missing edge", async () => {
    const harness = await setup();
    const { run, source, input, worker } = await prepare(harness);
    await harness.service.create(
      harness.owner,
      pageInput({ scope: "project", projectId: "alpha", title: "new" }),
    );
    await worker.apply(run, source, input, async () => IMPORT_IDENTITY);
    expect(
      await harness.mappings.findItem(run.id, source.sourceKey),
    ).toMatchObject({ action: "conflict" });
    const missing = { ...source, sourceKey: "missing", targetKey: "missing" };
    await worker.apply(run, missing, input, async () => IMPORT_IDENTITY);
    expect(await harness.mappings.findItem(run.id, "missing")).toMatchObject({
      action: "failed",
      errorCode: "INVALID_REQUEST",
    });
  });

  it("rolls back page, mapping, attachments and copied bytes when durable outcome persistence fails", async () => {
    const harness = await setup();
    const staged = await harness.dependencies.staging.write(bytes(PNG), {
      absoluteLimit: 1024,
      limitFor: () => 1024,
    });
    await harness.database.execute(
      "INSERT INTO agent_assets (id, user_id, file_name, storage_name, content_type, kind, checksum, size, status, created_at, expires_at) VALUES ('asset', 'writer', 'image.png', $name, 'image/png', 'media', $checksum, $size, 'staged', 0, $expires);",
      {
        name: staged.storageName,
        checksum: staged.checksum,
        size: staged.size,
        expires: Date.now() + 60_000,
      },
    );
    const { run, source, input, worker } = await prepare(harness);
    const events = vi.fn();
    harness.dependencies.events.subscribe(events);
    const error = new Error("outcome disk failure");
    vi.spyOn(
      AgentImportRepository.prototype,
      "recordItem",
    ).mockRejectedValueOnce(error);
    await expect(
      worker.apply(
        run,
        source,
        {
          ...input,
          assets: [{ sourceKey: source.sourceKey, assetIds: ["asset"] }],
        },
        async () => IMPORT_IDENTITY,
      ),
    ).rejects.toBe(error);
    expect(await harness.database.query("SELECT id FROM wiki_pages;")).toEqual(
      [],
    );
    expect(
      await harness.database.query(
        "SELECT source_key FROM agent_import_sources;",
      ),
    ).toEqual([]);
    expect(
      await harness.database.query("SELECT id FROM wiki_attachments;"),
    ).toEqual([]);
    expect(
      await harness.database.query("SELECT status FROM agent_assets;"),
    ).toEqual([["staged"]]);
    expect(
      await readdir(path.join(harness.filesDirectory, "attachments")),
    ).toEqual([]);
    expect(await readdir(path.join(harness.filesDirectory, "staging"))).toEqual(
      [staged.storageName],
    );
    expect(events).not.toHaveBeenCalled();
    await worker.apply(
      run,
      source,
      {
        ...input,
        assets: [{ sourceKey: source.sourceKey, assetIds: ["asset"] }],
      },
      async () => IMPORT_IDENTITY,
    );
    expect(
      await harness.mappings.findItem(run.id, source.sourceKey),
    ).toMatchObject({ action: "created", assets: [{ assetId: "asset" }] });
    expect(
      await harness.database.query("SELECT status FROM agent_assets;"),
    ).toEqual([["linked"]]);
    expect(
      await readdir(path.join(harness.filesDirectory, "attachments")),
    ).toHaveLength(1);
    expect(events.mock.calls.map(([event]) => event.type)).toEqual([
      "wiki.page.created",
      "asset.linked",
    ]);
  });
});

describe("source baseline comparisons", () => {
  const setup = useWikiImportApplyHarness();

  it.each([
    "content",
    "revision",
    "parent",
    "template",
    "kind",
    "project",
    "scope",
  ])("does not overwrite a changed %s", async (change) => {
    const harness = await setup();
    const input = await confirmedImport(harness);
    await harness.imports.apply(
      IMPORT_IDENTITY,
      input,
      async () => IMPORT_IDENTITY,
    );
    const mapping = await harness.mappings.findSource("alpha", "new.md");
    if (!mapping) throw new Error("Expected source mapping.");
    const parent = await harness.service.create(
      harness.owner,
      pageInput({ scope: "project", projectId: "alpha", title: "Parent" }),
    );
    await harness.database.execute(
      "INSERT INTO department_members (user_id, department_id) VALUES ('writer', 'beta');",
    );
    const query = {
      content:
        "UPDATE agent_import_sources SET content_hash = 'changed' WHERE target_id = $id;",
      revision: "UPDATE wiki_pages SET revision = 2 WHERE id = $id;",
      parent: "UPDATE wiki_pages SET parent_id = $parent WHERE id = $id;",
      template: "UPDATE wiki_pages SET is_template = TRUE WHERE id = $id;",
      kind: "UPDATE agent_import_sources SET target_kind = 'ticket' WHERE target_id = $id;",
      project: "UPDATE wiki_pages SET project_id = 'beta' WHERE id = $id;",
      scope: "UPDATE wiki_pages SET scope = 'instance' WHERE id = $id;",
    }[change];
    if (!query) throw new Error("Expected mutation.");
    await harness.database.execute(
      query,
      change === "parent"
        ? { parent: parent.id, id: mapping.targetId }
        : { id: mapping.targetId },
    );
    const repeat = await confirmedImport(harness, input, "repeat");
    const response = await harness.imports.apply(
      IMPORT_IDENTITY,
      repeat,
      async () => IMPORT_IDENTITY,
    );
    expect(appliedImport(response)).toMatchObject({
      status: "partial",
      counts: { created: 0, skipped: 0 },
      items: [
        {
          errorCode:
            change === "project" || change === "scope"
              ? "NOT_FOUND"
              : "CONFLICT",
        },
      ],
    });
    expect(
      await harness.database.query(
        "SELECT content FROM wiki_pages WHERE id = $id;",
        { id: mapping.targetId },
      ),
    ).toEqual([["Body"]]);
    expect(await harness.mappings.findSource("alpha", "new.md")).toMatchObject({
      lastRunId: mapping.lastRunId,
    });
  });
});
