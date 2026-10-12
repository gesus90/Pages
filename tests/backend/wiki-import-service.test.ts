import { readdir } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import { AgentImportRepository } from "@/backend/database/repositories/agents/AgentImportRepository";
import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { ProjectAccessDeniedError } from "@/backend/error/ProjectErrors";
import { WikiAccessDeniedError } from "@/backend/error/WikiErrors";
import { WikiImportPlanner } from "@/backend/service/agents/WikiImportPlanner";
import { WikiImportSourceService } from "@/backend/service/agents/WikiImportSourceService";
import { PAGES_AGENT_LIMITS } from "@/definition/PagesAgentOperations";

import { pageInput } from "../helpers/wiki-harness";
import { importRequest } from "../helpers/wiki-import";
import {
  appliedImport,
  confirmedImport,
  IMPORT_IDENTITY,
  useWikiImportApplyHarness,
} from "../helpers/wiki-import-apply";

describe("recoverable wiki import application", () => {
  const setup = useWikiImportApplyHarness();

  it("creates parent-first pages, mappings and exact Markdown and repeats without extra writes or events", async () => {
    const harness = await setup();
    const input = await confirmedImport(
      harness,
      importRequest([
        {
          sourceKey: "group/nested/a.md",
          content: "# A\r\n![image](image.png)\n",
        },
      ]),
    );
    const events: unknown[] = [];
    harness.dependencies.events.subscribe((event) => events.push(event));
    const response = await harness.imports.apply(
      IMPORT_IDENTITY,
      input,
      async () => IMPORT_IDENTITY,
    );
    const result = appliedImport(response);
    expect(result).toMatchObject({
      status: "complete",
      counts: { created: 3, skipped: 0, conflict: 0, failed: 0 },
      items: [
        { sourceKey: "directory:group", action: "created" },
        { sourceKey: "directory:group/nested", action: "created" },
        { sourceKey: "group/nested/a.md", action: "created" },
      ],
    });
    expect(
      await harness.imports.apply(
        IMPORT_IDENTITY,
        input,
        async () => IMPORT_IDENTITY,
      ),
    ).toEqual(response);
    const repeat = await confirmedImport(harness, input, "repeat");
    expect(
      appliedImport(
        await harness.imports.apply(
          IMPORT_IDENTITY,
          repeat,
          async () => IMPORT_IDENTITY,
        ),
      ),
    ).toMatchObject({
      status: "complete",
      counts: { created: 0, skipped: 3, conflict: 0, failed: 0 },
    });
    expect(
      await harness.database.query("SELECT COUNT(*) FROM wiki_pages;"),
    ).toEqual([[3]]);
    expect(
      await harness.database.query(
        "SELECT source, COUNT(*) FROM project_activity WHERE category = 'wiki' GROUP BY source;",
      ),
    ).toEqual([["mcp", 3]]);
    expect(
      await harness.database.query(
        "SELECT COUNT(*) FROM agent_import_sources;",
      ),
    ).toEqual([[3]]);
    expect(
      await harness.database.query(
        "SELECT content FROM wiki_pages WHERE title = 'A';",
      ),
    ).toEqual([[input.manifest.files[0]?.content]]);
    expect(events).toEqual(
      result.items.map((item) => ({
        type: "wiki.page.created",
        id: item.pageId,
      })),
    );
    expect(
      await harness.mappings.findSource("alpha", "group/nested/a.md"),
    ).toMatchObject({
      targetKind: "wiki",
      targetRevision: 1,
      lastRunId: appliedImport(
        await harness.imports.apply(
          IMPORT_IDENTITY,
          repeat,
          async () => IMPORT_IDENTITY,
        ),
      ).runId,
    });
  });

  it.each([true, false])(
    "serializes concurrent imports with the same operation ID: %s",
    async (sameId) => {
      const harness = await setup();
      const input = await confirmedImport(harness);
      const responses = await Promise.all([
        harness.imports.apply(
          IMPORT_IDENTITY,
          input,
          async () => IMPORT_IDENTITY,
        ),
        harness.imports.apply(
          IMPORT_IDENTITY,
          { ...input, operationId: sameId ? input.operationId : "other" },
          async () => IMPORT_IDENTITY,
        ),
      ]);
      expect(
        await harness.database.query("SELECT COUNT(*) FROM wiki_pages;"),
      ).toEqual([[1]]);
      expect(
        await harness.database.query(
          "SELECT COUNT(*) FROM agent_import_sources;",
        ),
      ).toEqual([[1]]);
      const results = responses.map(appliedImport);
      expect(results[0]?.items[0]?.pageId).toBe(results[1]?.items[0]?.pageId);
      if (sameId) expect(responses[0]).toEqual(responses[1]);
      else
        expect(results.map((result) => result.items[0]?.action).sort()).toEqual(
          ["created", "skipped"],
        );
    },
  );

  it("resumes after interruption between sources and replays already committed IDs", async () => {
    const harness = await setup();
    const input = await confirmedImport(
      harness,
      importRequest([
        { sourceKey: "a.md", content: "A" },
        { sourceKey: "b.md", content: "B" },
      ]),
    );
    const verify = vi
      .fn()
      .mockResolvedValueOnce(IMPORT_IDENTITY)
      .mockRejectedValueOnce(new Error("connection interrupted"));
    await expect(
      harness.imports.apply(IMPORT_IDENTITY, input, verify),
    ).rejects.toThrow("connection interrupted");
    expect(
      await harness.database.query(
        "SELECT status, created_count FROM agent_import_runs;",
      ),
    ).toEqual([["running", 1]]);
    const first = await harness.mappings.findSource("alpha", "a.md");
    const response = await harness.imports.apply(
      IMPORT_IDENTITY,
      input,
      async () => IMPORT_IDENTITY,
    );
    expect(appliedImport(response)).toMatchObject({
      status: "complete",
      counts: { created: 2, failed: 0 },
      items: [
        { pageId: first?.targetId, action: "created" },
        { action: "created" },
      ],
    });
    expect(
      await harness.imports.apply(
        IMPORT_IDENTITY,
        input,
        async () => IMPORT_IDENTITY,
      ),
    ).toEqual(response);
    expect(
      await harness.database.query("SELECT COUNT(*) FROM wiki_pages;"),
    ).toEqual([[2]]);
  });

  it("keeps completed source outcomes recoverable after a lost final response", async () => {
    const harness = await setup();
    const input = await confirmedImport(harness);
    const verify = vi
      .fn()
      .mockResolvedValueOnce(IMPORT_IDENTITY)
      .mockRejectedValueOnce(new McpAuthorizationError("invalid_token", 401));
    await expect(
      harness.imports.apply(IMPORT_IDENTITY, input, verify),
    ).rejects.toMatchObject({ status: 401 });
    const mapping = await harness.mappings.findSource("alpha", "new.md");
    const response = await harness.imports.apply(
      IMPORT_IDENTITY,
      input,
      async () => IMPORT_IDENTITY,
    );
    expect(appliedImport(response).items[0]?.pageId).toBe(mapping?.targetId);
    expect(
      await harness.imports.apply(
        IMPORT_IDENTITY,
        input,
        async () => IMPORT_IDENTITY,
      ),
    ).toEqual(response);
    expect(
      await harness.database.query("SELECT COUNT(*) FROM wiki_pages;"),
    ).toEqual([[1]]);
  });
});

describe("confirmed import identity and plan", () => {
  const setup = useWikiImportApplyHarness();

  it("rejects stale plans before reservation and binds a retry key to its exact operation and package", async () => {
    const harness = await setup();
    const input = await confirmedImport(harness);
    await expect(
      harness.imports.apply(
        IMPORT_IDENTITY,
        { ...input, fingerprint: "0".repeat(64) },
        async () => IMPORT_IDENTITY,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      await harness.database.query("SELECT id FROM agent_import_runs;"),
    ).toEqual([]);
    await harness.imports.apply(
      IMPORT_IDENTITY,
      input,
      async () => IMPORT_IDENTITY,
    );
    await expect(
      harness.imports.apply(
        IMPORT_IDENTITY,
        {
          ...input,
          manifest: {
            ...input.manifest,
            files: [{ sourceKey: "new.md", content: "changed" }],
          },
        },
        async () => IMPORT_IDENTITY,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await harness.database.execute(
      "UPDATE agent_operation_keys SET operation = 'wiki.page.create' WHERE operation_id = $id;",
      { id: input.operationId },
    );
    await expect(
      harness.imports.apply(
        IMPORT_IDENTITY,
        input,
        async () => IMPORT_IDENTITY,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("refuses reservation without current write rights and re-verifies identity before returning IDs", async () => {
    const harness = await setup();
    const input = await confirmedImport(harness);
    const verify = vi
      .fn()
      .mockResolvedValueOnce(IMPORT_IDENTITY)
      .mockResolvedValueOnce({ ...IMPORT_IDENTITY, userId: "other" });
    await expect(
      harness.imports.apply(IMPORT_IDENTITY, input, verify),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await harness.database.execute(
      "DELETE FROM role_permissions WHERE role_id = 'role-writer';",
    );
    await expect(
      harness.imports.apply(
        IMPORT_IDENTITY,
        input,
        async () => IMPORT_IDENTITY,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("detects a missing durable run or malformed internal planner result", async () => {
    const harness = await setup();
    const input = await confirmedImport(harness);
    await harness.imports.apply(
      IMPORT_IDENTITY,
      input,
      async () => IMPORT_IDENTITY,
    );
    vi.spyOn(AgentImportRepository.prototype, "findRun").mockResolvedValueOnce(
      null,
    );
    await expect(
      harness.imports.apply(
        IMPORT_IDENTITY,
        input,
        async () => IMPORT_IDENTITY,
      ),
    ).rejects.toThrow("Import run unavailable.");
    vi.spyOn(WikiImportPlanner.prototype, "plan").mockResolvedValueOnce({
      apiVersion: "1",
      result: { id: "invalid", name: "Invalid" },
    });
    await expect(
      harness.imports.apply(
        IMPORT_IDENTITY,
        { ...input, operationId: "next" },
        async () => IMPORT_IDENTITY,
      ),
    ).rejects.toThrow("Import plan unavailable.");
    expect(
      await new AgentOperationKeyRepository(harness.database).find(
        "writer",
        "next",
      ),
    ).toBeNull();
  });

  it.each([new WikiAccessDeniedError(), new ProjectAccessDeniedError()])(
    "translates policy errors at the application boundary",
    async (error) => {
      const harness = await setup();
      const input = await confirmedImport(harness);
      vi.spyOn(
        WikiImportSourceService.prototype,
        "apply",
      ).mockRejectedValueOnce(error);
      await expect(
        harness.imports.apply(
          IMPORT_IDENTITY,
          input,
          async () => IMPORT_IDENTITY,
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    },
  );

  it("preserves authorization service failures and bounds the completed response", async () => {
    const harness = await setup();
    const input = await confirmedImport(harness);
    const unavailable = new McpAuthorizationError("unavailable", 503);
    vi.spyOn(WikiImportSourceService.prototype, "apply").mockRejectedValueOnce(
      unavailable,
    );
    await expect(
      harness.imports.apply(
        IMPORT_IDENTITY,
        input,
        async () => IMPORT_IDENTITY,
      ),
    ).rejects.toBe(unavailable);
    const response = await harness.imports.apply(
      IMPORT_IDENTITY,
      input,
      async () => IMPORT_IDENTITY,
    );
    const items = appliedImport(response).items;
    const item = items[0];
    if (!item) throw new Error("Expected committed source.");
    vi.spyOn(
      AgentImportRepository.prototype,
      "listItems",
    ).mockResolvedValueOnce([
      {
        ...item,
        assets: [
          {
            assetId: "a".repeat(PAGES_AGENT_LIMITS.responseBytes),
            attachmentId: "id",
            link: "/asset",
          },
        ],
      },
    ]);
    await expect(
      harness.imports.apply(
        IMPORT_IDENTITY,
        input,
        async () => IMPORT_IDENTITY,
      ),
    ).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      details: {
        constraint: "responseBytes",
        limit: PAGES_AGENT_LIMITS.responseBytes,
      },
    });
    expect(await readdir(harness.filesDirectory)).toEqual([]);
  });

  it("returns source failures for invalid paths while preserving independent successes and never adopting existing titles", async () => {
    const harness = await setup();
    await harness.service.create(
      harness.owner,
      pageInput({
        scope: "project",
        projectId: "alpha",
        title: "existing",
        content: "Manual",
      }),
    );
    const input = await confirmedImport(
      harness,
      importRequest([
        { sourceKey: "a.md", content: "# A" },
        { sourceKey: "../bad.md", content: "Bad" },
        { sourceKey: "existing.md", content: "Overwrite" },
      ]),
    );
    const response = await harness.imports.apply(
      IMPORT_IDENTITY,
      input,
      async () => IMPORT_IDENTITY,
    );
    expect(appliedImport(response)).toMatchObject({
      status: "partial",
      counts: { created: 1, skipped: 0, conflict: 1, failed: 1 },
    });
    expect(
      await harness.imports.apply(
        IMPORT_IDENTITY,
        input,
        async () => IMPORT_IDENTITY,
      ),
    ).toEqual(response);
    expect(
      await harness.database.query(
        "SELECT content FROM wiki_pages WHERE title = 'existing';",
      ),
    ).toEqual([["Manual"]]);
  });
});
