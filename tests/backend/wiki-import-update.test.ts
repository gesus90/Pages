import { describe, expect, it, vi } from "vitest";

import { AgentImportRepository } from "@/backend/database/repositories/agents/AgentImportRepository";
import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";

import { pageInput } from "../helpers/wiki-harness";
import { importRequest } from "../helpers/wiki-import";
import { confirmedImport, IMPORT_IDENTITY } from "../helpers/wiki-import-apply";
import {
  confirmedUpdate,
  updatedImport,
  useWikiImportUpdateHarness,
} from "../helpers/wiki-import-update";

describe("atomic imported wiki updates", () => {
  const setup = useWikiImportUpdateHarness();

  it("updates only the changed mapped page, preserves its first version and replays without writes or events", async () => {
    const harness = await setup();
    const original = importRequest([
      { sourceKey: "group/a.md", content: "# A\nOriginal" },
      { sourceKey: "group/b.md", content: "# B\nUnchanged" },
    ]);
    await harness.imports.apply(
      IMPORT_IDENTITY,
      await confirmedImport(harness, original),
      async () => IMPORT_IDENTITY,
    );
    const mapping = await harness.mappings.findSource("alpha", "group/a.md");
    if (!mapping) throw new Error("Expected imported page.");
    const changed = importRequest([
      { sourceKey: "group/a.md", content: "# A\nChanged" },
      { sourceKey: "group/b.md", content: "# B\nUnchanged" },
    ]);
    const input = await confirmedUpdate(harness, changed);
    const events = vi.fn();
    const committed: Promise<unknown>[] = [];
    harness.dependencies.events.subscribe(events);
    harness.dependencies.events.subscribe(() => {
      committed.push(
        harness.database.query(
          "SELECT result_json FROM agent_operation_keys WHERE operation = 'wiki.import.update';",
        ),
      );
    });
    const verify = vi.fn().mockResolvedValue(IMPORT_IDENTITY);
    const response = await harness.updates.update(
      IMPORT_IDENTITY,
      input,
      verify,
    );
    expect(updatedImport(response)).toMatchObject({
      status: "complete",
      counts: { updated: 1, skipped: 1, conflict: 0, failed: 0 },
      items: [
        {
          sourceKey: "group/a.md",
          action: "updated",
          reason: "source_changed",
          pageId: mapping.targetId,
          revision: 2,
        },
        {
          sourceKey: "group/b.md",
          action: "skipped",
          reason: "unchanged",
          revision: 1,
        },
      ],
    });
    expect(verify).toHaveBeenCalledOnce();
    expect(events).toHaveBeenCalledExactlyOnceWith({
      type: "wiki.page.updated",
      id: mapping.targetId,
    });
    expect(await Promise.all(committed)).toEqual([
      [[JSON.stringify(response.result)]],
    ]);
    expect(
      await harness.updates.update(
        IMPORT_IDENTITY,
        input,
        async () => IMPORT_IDENTITY,
      ),
    ).toEqual(response);
    expect(events).toHaveBeenCalledOnce();
    expect(
      (await harness.repository.versions.list(mapping.targetId)).map(
        (version) => version.revision,
      ),
    ).toEqual([2, 1]);
    expect(
      await harness.mappings.findSource("alpha", "group/a.md"),
    ).toMatchObject({
      targetRevision: 2,
      lastRunId: expect.stringMatching(/^update:[a-f0-9]{64}$/),
    });
    const repeat = await confirmedImport(
      harness,
      changed,
      "apply-after-update",
    );
    expect(
      await harness.imports.apply(
        IMPORT_IDENTITY,
        repeat,
        async () => IMPORT_IDENTITY,
      ),
    ).toMatchObject({ result: { counts: { skipped: 3, conflict: 0 } } });
  });

  it("rolls back all page versions and baselines when recording the operation fails, then retries fully", async () => {
    const harness = await setup();
    const original = importRequest([
      { sourceKey: "a.md", content: "A" },
      { sourceKey: "b.md", content: "B" },
    ]);
    await harness.imports.apply(
      IMPORT_IDENTITY,
      await confirmedImport(harness, original),
      async () => IMPORT_IDENTITY,
    );
    const before = await harness.database.query(
      "SELECT id, content, revision FROM wiki_pages ORDER BY title;",
    );
    const mappings = await harness.database.query(
      "SELECT source_key, content_hash, target_revision, last_run_id FROM agent_import_sources ORDER BY source_key;",
    );
    const input = await confirmedUpdate(
      harness,
      importRequest([
        { sourceKey: "a.md", content: "Changed A" },
        { sourceKey: "b.md", content: "Changed B" },
      ]),
    );
    const failure = new Error("operation persistence unavailable");
    vi.spyOn(
      AgentOperationKeyRepository.prototype,
      "insert",
    ).mockRejectedValueOnce(failure);
    const events = vi.fn();
    harness.dependencies.events.subscribe(events);
    await expect(
      harness.updates.update(
        IMPORT_IDENTITY,
        input,
        async () => IMPORT_IDENTITY,
      ),
    ).rejects.toBe(failure);
    expect(
      await harness.database.query(
        "SELECT id, content, revision FROM wiki_pages ORDER BY title;",
      ),
    ).toEqual(before);
    expect(
      await harness.database.query(
        "SELECT source_key, content_hash, target_revision, last_run_id FROM agent_import_sources ORDER BY source_key;",
      ),
    ).toEqual(mappings);
    expect(
      await harness.database.query("SELECT COUNT(*) FROM wiki_page_versions;"),
    ).toEqual([[2]]);
    expect(events).not.toHaveBeenCalled();
    expect(
      await harness.updates.update(
        IMPORT_IDENTITY,
        input,
        async () => IMPORT_IDENTITY,
      ),
    ).toMatchObject({ result: { counts: { updated: 2 } } });
    expect(events).toHaveBeenCalledTimes(2);
  });

  it("never adopts an unmapped page with the same name and replays failures without exposing a page", async () => {
    const harness = await setup();
    const page = await harness.service.create(
      harness.owner,
      pageInput({
        projectId: "alpha",
        scope: "project",
        title: "new",
        content: "Manual",
      }),
    );
    const input = await confirmedUpdate(harness);
    const response = await harness.updates.update(
      IMPORT_IDENTITY,
      input,
      async () => IMPORT_IDENTITY,
    );
    expect(updatedImport(response)).toMatchObject({
      status: "partial",
      counts: { failed: 1 },
      items: [
        {
          action: "failed",
          reason: "not_imported",
          errorCode: "NOT_FOUND",
          pageId: null,
          revision: null,
        },
      ],
    });
    expect(
      await harness.updates.update(
        IMPORT_IDENTITY,
        input,
        async () => IMPORT_IDENTITY,
      ),
    ).toEqual(response);
    expect(await harness.service.read(harness.actor, page.id)).toMatchObject({
      view: { page: { content: "Manual", revision: 1 } },
    });
  });
});

describe("import update conflict and version protection", () => {
  const setup = useWikiImportUpdateHarness();

  it("keeps manual text byte-for-byte until explicit overwrite and can restore that version", async () => {
    const harness = await setup();
    await harness.imports.apply(
      IMPORT_IDENTITY,
      await confirmedImport(harness),
      async () => IMPORT_IDENTITY,
    );
    const mapping = await harness.mappings.findSource("alpha", "new.md");
    if (!mapping) throw new Error("Expected mapping.");
    const manual = "Manual\r\ntext\r";
    await harness.service.update(harness.actor, mapping.targetId, {
      title: "new",
      content: manual,
      icon: "📘",
      expectedRevision: 1,
    });
    const changed = importRequest([
      { sourceKey: "new.md", content: "New source" },
    ]);
    const stale = await confirmedUpdate(harness, changed);
    expect(
      await harness.updates.update(
        IMPORT_IDENTITY,
        stale,
        async () => IMPORT_IDENTITY,
      ),
    ).toMatchObject({
      result: {
        items: [
          { reason: "stale_revision", errorCode: "CONFLICT", revision: 2 },
        ],
      },
    });
    const input = {
      ...(await confirmedUpdate(harness, changed, "manual-conflict")),
      updates: [{ sourceKey: "new.md", expectedRevision: 2, overwrite: false }],
    };
    expect(
      await harness.updates.update(
        IMPORT_IDENTITY,
        input,
        async () => IMPORT_IDENTITY,
      ),
    ).toMatchObject({
      result: {
        items: [{ action: "conflict", reason: "manual_change", revision: 2 }],
      },
    });
    expect(
      await harness.service.read(harness.actor, mapping.targetId),
    ).toMatchObject({ view: { page: { content: manual, revision: 2 } } });
    const overwritten = {
      ...(await confirmedUpdate(harness, changed, "explicit-overwrite")),
      updates: [{ sourceKey: "new.md", expectedRevision: 2, overwrite: true }],
    };
    expect(
      await harness.updates.update(
        IMPORT_IDENTITY,
        overwritten,
        async () => IMPORT_IDENTITY,
      ),
    ).toMatchObject({
      result: {
        items: [{ action: "updated", reason: "overwritten", revision: 3 }],
      },
    });
    const versions = await harness.service.listVersions(
      harness.actor,
      mapping.targetId,
    );
    const previous = versions.find((version) => version.revision === 2);
    if (!previous) throw new Error("Expected manual version.");
    expect(
      await harness.service.restoreVersion(
        harness.actor,
        mapping.targetId,
        previous.id,
      ),
    ).toMatchObject({ content: manual, icon: "📘", revision: 4 });
  });

  it.each(["same", "line-endings", "manual-equal"])(
    "skips %s without creating a version, refreshing the baseline only when necessary",
    async (kind) => {
      const harness = await setup();
      await harness.imports.apply(
        IMPORT_IDENTITY,
        await confirmedImport(harness),
        async () => IMPORT_IDENTITY,
      );
      const mapping = await harness.mappings.findSource("alpha", "new.md");
      if (!mapping) throw new Error("Expected mapping.");
      let content = "Body";
      let expectedRevision = 1;
      if (kind === "line-endings") content = "\uFEFFBody";
      if (kind === "manual-equal") {
        content = "Manual\ntext\n";
        expectedRevision = 2;
        await harness.service.update(harness.actor, mapping.targetId, {
          title: "new",
          content: "\uFEFFManual\r\ntext\r",
          expectedRevision: 1,
          icon: null,
        });
      }
      const input = {
        ...(await confirmedUpdate(
          harness,
          importRequest([{ sourceKey: "new.md", content }]),
        )),
        updates: [{ sourceKey: "new.md", expectedRevision, overwrite: false }],
      };
      const refresh = vi.spyOn(
        AgentImportRepository.prototype,
        "refreshSource",
      );
      const before = await harness.database.query(
        "SELECT id, content, revision FROM wiki_pages;",
      );
      const versions = await harness.database.query(
        "SELECT id FROM wiki_page_versions;",
      );
      expect(
        await harness.updates.update(
          IMPORT_IDENTITY,
          input,
          async () => IMPORT_IDENTITY,
        ),
      ).toMatchObject({
        result: {
          counts: { skipped: 1, updated: 0 },
          items: [{ reason: "unchanged", revision: expectedRevision }],
        },
      });
      expect(refresh).toHaveBeenCalledTimes(kind === "same" ? 0 : 1);
      expect(
        await harness.database.query(
          "SELECT id, content, revision FROM wiki_pages;",
        ),
      ).toEqual(before);
      expect(
        await harness.database.query("SELECT id FROM wiki_page_versions;"),
      ).toEqual(versions);
      expect(
        await harness.mappings.findSource("alpha", "new.md"),
      ).toMatchObject({ targetRevision: expectedRevision });
    },
  );

  it.each([true, false])(
    "rejects stale revisions even with overwrite=%s",
    async (overwrite) => {
      const harness = await setup();
      await harness.imports.apply(
        IMPORT_IDENTITY,
        await confirmedImport(harness),
        async () => IMPORT_IDENTITY,
      );
      const input = {
        ...(await confirmedUpdate(harness)),
        updates: [{ sourceKey: "new.md", expectedRevision: 2, overwrite }],
      };
      expect(
        await harness.updates.update(
          IMPORT_IDENTITY,
          input,
          async () => IMPORT_IDENTITY,
        ),
      ).toMatchObject({
        result: {
          items: [
            { action: "conflict", reason: "stale_revision", revision: 1 },
          ],
        },
      });
      expect(
        await harness.database.query("SELECT revision FROM wiki_pages;"),
      ).toEqual([[1]]);
    },
  );
});
