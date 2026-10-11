import { describe, expect, it, vi } from "vitest";

import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { ProjectAccessDeniedError } from "@/backend/error/ProjectErrors";
import { WikiImportPlanner } from "@/backend/service/agents/WikiImportPlanner";

import { importRequest } from "../helpers/wiki-import";
import { confirmedImport, IMPORT_IDENTITY } from "../helpers/wiki-import-apply";
import {
  confirmedUpdate,
  useWikiImportUpdateHarness,
} from "../helpers/wiki-import-update";

describe("confirmed update identity and recovery", () => {
  const setup = useWikiImportUpdateHarness();

  it("binds replay to the operation and exact canonical input and rechecks page visibility", async () => {
    const harness = await setup();
    await harness.imports.apply(
      IMPORT_IDENTITY,
      await confirmedImport(harness),
      async () => IMPORT_IDENTITY,
    );
    const input = await confirmedUpdate(
      harness,
      importRequest([{ sourceKey: "new.md", content: "Updated" }]),
    );
    await expect(
      harness.updates.update(
        IMPORT_IDENTITY,
        { ...input, fingerprint: "0".repeat(64) },
        async () => IMPORT_IDENTITY,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await harness.updates.update(
      IMPORT_IDENTITY,
      input,
      async () => IMPORT_IDENTITY,
    );
    await expect(
      harness.updates.update(
        IMPORT_IDENTITY,
        {
          ...input,
          updates: [
            { sourceKey: "new.md", expectedRevision: 1, overwrite: true },
          ],
        },
        async () => IMPORT_IDENTITY,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await harness.database.execute(
      "UPDATE agent_operation_keys SET operation = 'wiki.page.create' WHERE operation_id = $id;",
      { id: input.operationId },
    );
    await expect(
      harness.updates.update(
        IMPORT_IDENTITY,
        input,
        async () => IMPORT_IDENTITY,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await harness.database.execute(
      "UPDATE agent_operation_keys SET operation = 'wiki.import.update' WHERE operation_id = $id;",
      { id: input.operationId },
    );
    await harness.database.execute("DELETE FROM wiki_pages;");
    await expect(
      harness.updates.update(
        IMPORT_IDENTITY,
        input,
        async () => IMPORT_IDENTITY,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects changed identity and fresh policy without writing", async () => {
    const harness = await setup();
    const input = await confirmedUpdate(harness);
    await expect(
      harness.updates.update(IMPORT_IDENTITY, input, async () => ({
        ...IMPORT_IDENTITY,
        userId: "owner",
      })),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await harness.database.execute(
      "DELETE FROM role_permissions WHERE role_id = 'role-writer';",
    );
    await expect(
      harness.updates.update(
        IMPORT_IDENTITY,
        input,
        async () => IMPORT_IDENTITY,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      await harness.database.query(
        "SELECT operation_id FROM agent_operation_keys;",
      ),
    ).toEqual([]);
  });

  it.each([
    new ProjectAccessDeniedError(),
    new McpAuthorizationError("invalid_token", 401),
    new McpAuthorizationError("unavailable", 503),
    new AgentOperationError("CONFLICT"),
    new Error("infrastructure unavailable"),
  ])(
    "translates policy failures and preserves credential or infrastructure failures: %s",
    async (failure) => {
      const harness = await setup();
      const input = await confirmedUpdate(harness);
      const operation = harness.updates.update(
        IMPORT_IDENTITY,
        input,
        async () => {
          throw failure;
        },
      );
      if (failure instanceof ProjectAccessDeniedError)
        await expect(operation).rejects.toMatchObject({ code: "FORBIDDEN" });
      else await expect(operation).rejects.toBe(failure);
      expect(
        await harness.database.query(
          "SELECT operation_id FROM agent_operation_keys;",
        ),
      ).toEqual([]);
    },
  );

  it("does not persist an operation when the planner fails to return a plan", async () => {
    const harness = await setup();
    const input = await confirmedUpdate(harness);
    vi.spyOn(WikiImportPlanner.prototype, "plan").mockResolvedValueOnce({
      apiVersion: "1",
      result: { id: "alpha", name: "Alpha" },
    });
    await expect(
      harness.updates.update(
        IMPORT_IDENTITY,
        input,
        async () => IMPORT_IDENTITY,
      ),
    ).rejects.toThrow("Import plan unavailable.");
    expect(
      await harness.database.query(
        "SELECT operation_id FROM agent_operation_keys;",
      ),
    ).toEqual([]);
  });
});
