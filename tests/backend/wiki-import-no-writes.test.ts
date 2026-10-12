import { rmSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { hashAgentCredential } from "@/backend/security/AgentCredential";
import { wireFixture } from "../helpers/mcp-authorization";
import { useMigratedDatabase } from "../helpers/test-database";
import { pageInput } from "../helpers/wiki-harness";
import { createWikiImportHarness, importRequest } from "../helpers/wiki-import";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

interface TableSnapshot {
  readonly count: number;
  readonly rows: readonly DatabaseValue[][];
}

async function snapshot(
  database: Database,
): Promise<Record<string, TableSnapshot>> {
  const schema = await database.query(
    "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'main' ORDER BY table_name, ordinal_position;",
  );
  const columns = new Map<string, string[]>();
  for (const row of schema) {
    const [table, column] = row;
    if (
      typeof table !== "string" ||
      typeof column !== "string" ||
      !/^\w+$/.test(table) ||
      !/^\w+$/.test(column)
    )
      throw new Error("Invalid schema identifier");
    const previous = columns.get(table) ?? [];
    previous.push(column);
    columns.set(table, previous);
  }
  const tables: Record<string, TableSnapshot> = {};
  for (const [table, names] of columns) {
    const rows = await database.query(
      `SELECT ${names.map((name) => `"${name}"`).join(", ")} FROM "${table}" ORDER BY ALL;`,
    );
    tables[table] = { count: rows.length, rows };
  }
  return tables;
}

describe("wiki import dry-run zero writes", () => {
  const getDatabase = useMigratedDatabase();
  const directories = new Set<string>();
  afterEach(() => {
    for (const directory of directories)
      rmSync(directory, { recursive: true, force: true });
    directories.clear();
  });

  it("preserves every table and row through previews while recording only successful credential use", async () => {
    const database = getDatabase();
    const harness = await createWikiImportHarness(database);
    directories.add(harness.filesDirectory);
    const parent = await harness.service.create(
      harness.owner,
      pageInput({ scope: "project", projectId: "alpha", title: "Existing" }),
    );
    await harness.service.create(
      harness.owner,
      pageInput({ parentId: parent.id, title: "new" }),
    );
    await harness.service.setFavorite(harness.actor, parent.id, true);
    await harness.service.setExpanded(harness.actor, parent.id, true);
    await harness.service.read(harness.actor, parent.id);
    const authorization = new AuthorizationRepository(database);
    const users = new UserRepository(database);
    const fixture = wireFixture(database);
    fixture.users.getById.mockImplementation((id: string) =>
      users.findById(id),
    );
    fixture.administration.getContext.mockImplementation(async (id: string) => {
      const account = (await authorization.snapshot()).accounts.find(
        (entry) => entry.userId === id,
      );
      if (!account) throw new Error("Missing test account");
      return account;
    });
    const created = await fixture.personal.create(
      harness.actor.id,
      "dry-run-test",
      null,
    );
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    await fixture.api.verify(created.token);
    const before = await snapshot(database);
    expect(Object.keys(before)).toEqual(
      expect.arrayContaining([
        "wiki_pages",
        "wiki_page_versions",
        "wiki_attachments",
        "wiki_favorites",
        "wiki_recent_pages",
        "wiki_expanded_pages",
        "agent_assets",
        "agent_operation_keys",
        "personal_agent_tokens",
      ]),
    );
    expect(before.wiki_recent_pages?.count).toBe(1);
    const execute = vi.spyOn(database, "execute");
    const used = vi.spyOn(fixture.personalRepository, "used");
    const transactionalWrites: string[] = [];
    const runTransaction = database.transaction.bind(database);
    vi.spyOn(database, "transaction").mockImplementation(
      async <Result>(
        work: (connection: DatabaseTransaction) => Promise<Result>,
      ): Promise<Result> => {
        return runTransaction(async (connection) =>
          work({
            query: connection.query,
            execute: async (statement, parameters) => {
              transactionalWrites.push(statement);
              await connection.execute(statement, parameters);
            },
          }),
        );
      },
    );
    const visit = vi.spyOn(harness.repository.state, "recordVisit");
    const request = importRequest(
      [
        {
          sourceKey: "guide/README.md",
          content: "# Guide\n![image](a.png) [PDF](a.pdf)",
        },
        { sourceKey: "bare/new.md", content: "Body" },
      ],
      { parentId: parent.id },
    );
    for (const parameters of [
      request,
      { ...request, manifest: { ...request.manifest, files: [] } },
      request,
      importRequest(undefined, { parentId: parent.id }),
      importRequest([{ sourceKey: "../escape.md", content: "Body" }]),
    ]) {
      await fixture.api.handle(created.token, {
        operation: "wiki.import.plan",
        parameters,
      });
    }
    await expect(
      fixture.api.handle(created.token, {
        operation: "wiki.import.plan",
        parameters: importRequest(undefined, { projectId: "beta" }),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      fixture.api.handle(created.token, {
        operation: "wiki.import.plan",
        parameters: importRequest([
          { sourceKey: "large.md", content: "x".repeat(16_385) },
        ]),
      }),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    expect(await snapshot(database)).toEqual(before);
    expect(used).toHaveBeenCalledTimes(7);
    expect(execute).toHaveBeenCalledTimes(7);
    for (const [statement, parameters] of execute.mock.calls) {
      expect(statement).toContain("UPDATE personal_agent_tokens");
      expect(statement).toContain("SET last_used_at = CASE");
      expect(parameters).toEqual({
        hash: hashAgentCredential(created.token),
        now,
      });
    }
    expect((await fixture.personal.list(harness.actor.id))[0]?.lastUsedAt).toBe(
      now,
    );
    expect(transactionalWrites).toEqual([]);
    expect(visit).not.toHaveBeenCalled();
  });
});
