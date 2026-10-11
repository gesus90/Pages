import { describe, expect, it, vi } from "vitest";

import { AgentImportRepository } from "@/backend/database/repositories/agents/AgentImportRepository";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import {
  WikiAccessDeniedError,
  WikiValidationError,
} from "@/backend/error/WikiErrors";
import { resolveWikiImportContext } from "@/backend/service/agents/WikiImportContext";
import { wikiImportPackage } from "@/backend/service/agents/WikiImportPackage";
import { updateWikiImportSource } from "@/backend/service/agents/WikiImportUpdateSource";
import { WikiPageReader } from "@/backend/service/wiki/WikiPageReader";

import { bytes, PNG } from "../helpers/agent-writes";
import { pageInput } from "../helpers/wiki-harness";
import { importPlan, importRequest } from "../helpers/wiki-import";
import { confirmedImport, IMPORT_IDENTITY } from "../helpers/wiki-import-apply";
import {
  confirmedUpdate,
  useWikiImportUpdateHarness,
} from "../helpers/wiki-import-update";

import type { AgentImportPlan } from "@/definition/AgentImportManifest";
import type {
  AgentImportUpdateInput,
  AgentImportUpdateItem,
} from "@/definition/AgentImportUpdate";
import type { WikiImportSource } from "@/backend/service/agents/WikiImportPackage";
import type { WikiImportUpdateHarness } from "../helpers/wiki-import-update";

interface PreparedUpdate {
  readonly input: AgentImportUpdateInput;
  readonly plan: AgentImportPlan;
  readonly source: WikiImportSource;
}

async function prepare(
  harness: WikiImportUpdateHarness,
): Promise<PreparedUpdate> {
  await harness.imports.apply(
    IMPORT_IDENTITY,
    await confirmedImport(harness),
    async () => IMPORT_IDENTITY,
  );
  const input = await confirmedUpdate(
    harness,
    importRequest([{ sourceKey: "new.md", content: "Changed" }]),
  );
  const plan = importPlan(
    await harness.planner.plan(
      harness.actor,
      importRequest(input.manifest.files),
    ),
  );
  const source = wikiImportPackage({ ...input, assets: [] }, plan)[0];
  if (!source) throw new Error("Expected loaded source.");
  return { input, plan, source };
}

async function invokeSource(
  harness: WikiImportUpdateHarness,
  prepared: PreparedUpdate,
): Promise<AgentImportUpdateItem> {
  return harness.database.transaction(async (transaction) =>
    updateWikiImportSource(
      {
        context: await resolveWikiImportContext(transaction, "writer", "alpha"),
        repository: new AgentImportRepository(transaction),
        input: prepared.input,
        plan: prepared.plan,
        marker: "update:test",
      },
      prepared.source,
    ),
  );
}

describe("import update source structural guards", () => {
  const setup = useWikiImportUpdateHarness();

  it.each(["entry", "file", "edge", "page"])(
    "rejects a missing %s before touching the page",
    async (missing) => {
      const harness = await setup();
      const prepared = await prepare(harness);
      const malformed = {
        input: {
          ...prepared.input,
          updates: missing === "entry" ? [] : prepared.input.updates,
          manifest: {
            ...prepared.input.manifest,
            files: missing === "file" ? [] : prepared.input.manifest.files,
          },
        },
        plan: {
          ...prepared.plan,
          edges: missing === "edge" ? [] : prepared.plan.edges,
        },
        source: {
          ...prepared.source,
          page: missing === "page" ? null : prepared.source.page,
        },
      };
      expect(await invokeSource(harness, malformed)).toMatchObject({
        action: "failed",
        reason: "invalid_source",
        errorCode: "INVALID_REQUEST",
        pageId: null,
      });
      expect(
        await harness.database.query(
          "SELECT content, revision FROM wiki_pages;",
        ),
      ).toEqual([["Body", 1]]);
    },
  );

  it.each(["conflict", "forbidden"])(
    "honors a %s source diagnostic in the confirmed plan",
    async (kind) => {
      const harness = await setup();
      const prepared = await prepare(harness);
      const issue = {
        code:
          kind === "conflict" ? ("CONFLICT" as const) : ("FORBIDDEN" as const),
        reason: "invalid_path" as const,
        sourceKeys: [prepared.source.sourceKey],
        targetKey: prepared.source.targetKey,
      };
      expect(
        await invokeSource(harness, {
          ...prepared,
          plan: { ...prepared.plan, errors: [issue] },
        }),
      ).toMatchObject({
        action: kind === "conflict" ? "conflict" : "failed",
        reason: kind === "conflict" ? "plan_conflict" : "not_permitted",
        errorCode: issue.code,
      });
    },
  );
});

describe("mapped page protection", () => {
  const setup = useWikiImportUpdateHarness();

  it.each([
    [
      "kind",
      "UPDATE agent_import_sources SET target_kind = 'ticket';",
      "conflict",
      "plan_conflict",
    ],
    ["missing", "DELETE FROM wiki_pages;", "failed", "page_unavailable"],
    [
      "project",
      "UPDATE wiki_pages SET project_id = 'beta';",
      "failed",
      "page_unavailable",
    ],
    [
      "scope",
      "UPDATE wiki_pages SET scope = 'instance';",
      "failed",
      "page_unavailable",
    ],
    [
      "template",
      "UPDATE wiki_pages SET is_template = TRUE;",
      "conflict",
      "template",
    ],
  ])(
    "protects a mapped page after changing its %s",
    async (_, query, action, reason) => {
      const harness = await setup();
      const prepared = await prepare(harness);
      await harness.database.execute(
        "INSERT INTO department_members (user_id, department_id) VALUES ('writer', 'beta');",
      );
      await harness.database.execute(query);
      const before = await harness.database.query(
        "SELECT content, revision FROM wiki_pages;",
      );
      expect(await invokeSource(harness, prepared)).toMatchObject({
        action,
        reason,
      });
      expect(
        await harness.database.query(
          "SELECT content, revision FROM wiki_pages;",
        ),
      ).toEqual(before);
      expect(
        await harness.mappings.findSource("alpha", "new.md"),
      ).toMatchObject({ targetRevision: 1 });
    },
  );

  it("reports sibling title collisions, then renames without changing placement, icon or anchors", async () => {
    const harness = await setup();
    await prepare(harness);
    const mapping = await harness.mappings.findSource("alpha", "new.md");
    if (!mapping) throw new Error("Expected mapping.");
    const parent = await harness.service.create(
      harness.owner,
      pageInput({ scope: "project", projectId: "alpha", title: "Parent" }),
    );
    await harness.database.execute(
      "UPDATE wiki_pages SET icon = '📘', parent_id = $parent WHERE id = $id;",
      { parent: parent.id, id: mapping.targetId },
    );
    await harness.repository.anchors.replaceAnchors(mapping.targetId, [
      { kind: "department", targetId: "alpha" },
    ]);
    for (const title of ["Taken", "Other"])
      await harness.service.create(
        harness.owner,
        pageInput({ parentId: parent.id, title }),
      );
    const conflicting = await confirmedUpdate(
      harness,
      importRequest([{ sourceKey: "new.md", content: "# Taken\nChanged" }]),
    );
    expect(
      await harness.updates.update(
        IMPORT_IDENTITY,
        conflicting,
        async () => IMPORT_IDENTITY,
      ),
    ).toMatchObject({
      result: {
        items: [{ action: "conflict", reason: "title_conflict", revision: 1 }],
      },
    });
    const unique = await confirmedUpdate(
      harness,
      importRequest([{ sourceKey: "new.md", content: "# Renamed\nChanged" }]),
      "rename",
    );
    expect(
      await harness.updates.update(
        IMPORT_IDENTITY,
        unique,
        async () => IMPORT_IDENTITY,
      ),
    ).toMatchObject({
      result: { items: [{ action: "updated", revision: 2 }] },
    });
    expect(
      await harness.service.read(harness.actor, mapping.targetId),
    ).toMatchObject({
      view: { page: { title: "Renamed", parentId: parent.id, icon: "📘" } },
    });
    expect(
      await harness.repository.anchors.findAnchors(mapping.targetId),
    ).toMatchObject([{ kind: "department", targetId: "alpha" }]);
  });

  it("keeps linked assets and their source fingerprint after an update", async () => {
    const harness = await setup();
    for (const id of ["z", "a"]) {
      const staged = await harness.dependencies.staging.write(bytes(PNG), {
        absoluteLimit: 1024,
        limitFor: () => 1024,
      });
      await harness.database.execute(
        "INSERT INTO agent_assets (id, user_id, file_name, storage_name, content_type, kind, checksum, size, status, created_at, expires_at) VALUES ($id, 'writer', 'image.png', $name, 'image/png', 'media', $checksum, $size, 'staged', 0, $expires);",
        {
          id,
          name: staged.storageName,
          checksum: staged.checksum,
          size: staged.size,
          expires: Date.now() + 60_000,
        },
      );
    }
    const original = {
      ...(await confirmedImport(harness)),
      assets: [{ sourceKey: "new.md", assetIds: ["z", "a"] }],
    };
    await harness.imports.apply(
      IMPORT_IDENTITY,
      original,
      async () => IMPORT_IDENTITY,
    );
    const before = await harness.database.query(
      "SELECT id, page_id, storage_name FROM wiki_attachments ORDER BY id;",
    );
    expect(before).toHaveLength(2);
    const changed = importRequest([
      { sourceKey: "new.md", content: "Updated source" },
    ]);
    await harness.updates.update(
      IMPORT_IDENTITY,
      await confirmedUpdate(harness, changed),
      async () => IMPORT_IDENTITY,
    );
    expect(
      await harness.database.query(
        "SELECT id, page_id, storage_name FROM wiki_attachments ORDER BY id;",
      ),
    ).toEqual(before);
    const repeat = {
      ...(await confirmedImport(harness, changed, "apply-after-assets")),
      assets: original.assets,
    };
    expect(
      await harness.imports.apply(
        IMPORT_IDENTITY,
        repeat,
        async () => IMPORT_IDENTITY,
      ),
    ).toMatchObject({
      result: {
        items: [
          {
            action: "skipped",
            assets: expect.arrayContaining([
              {
                assetId: "a",
                attachmentId: expect.any(String),
                link: expect.any(String),
              },
              {
                assetId: "z",
                attachmentId: expect.any(String),
                link: expect.any(String),
              },
            ]),
          },
        ],
      },
    });
  });
});

describe("source failure translation", () => {
  const setup = useWikiImportUpdateHarness();

  it.each([
    new Error("storage unavailable"),
    new McpAuthorizationError("invalid_token", 401),
    new McpAuthorizationError("unavailable", 503),
    new WikiAccessDeniedError(),
    new WikiValidationError("titleRequired"),
    new AgentOperationError("CONFLICT"),
  ])(
    "reports expected failures and propagates infrastructure and credential failures: %s",
    async (failure) => {
      const harness = await setup();
      const prepared = await prepare(harness);
      vi.spyOn(WikiPageReader.prototype, "require").mockRejectedValueOnce(
        failure,
      );
      const outcome = invokeSource(harness, prepared);
      if (failure instanceof WikiAccessDeniedError)
        expect(await outcome).toMatchObject({
          action: "failed",
          reason: "not_permitted",
          errorCode: "FORBIDDEN",
        });
      else if (failure instanceof WikiValidationError)
        expect(await outcome).toMatchObject({
          action: "failed",
          reason: "invalid_source",
          errorCode: "INVALID_REQUEST",
        });
      else if (failure instanceof AgentOperationError)
        expect(await outcome).toMatchObject({
          action: "conflict",
          reason: "plan_conflict",
          errorCode: "CONFLICT",
        });
      else await expect(outcome).rejects.toBe(failure);
      expect(
        await harness.database.query(
          "SELECT content, revision FROM wiki_pages;",
        ),
      ).toEqual([["Body", 1]]);
    },
  );
});
