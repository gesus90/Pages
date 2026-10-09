import { describe, expect, it, vi } from "vitest";
import { ProjectLifecycleRepository } from "@/backend/database/repositories/project/ProjectLifecycleRepository";
import { WikiPageWriteRepository } from "@/backend/database/repositories/wiki/WikiPageWriteRepository";
import {
  assistantRequest,
  createAssistantHarness,
} from "../helpers/text-assistant";
import { useMigratedDatabase } from "../helpers/test-database";

describe("assistant deletion, expiry and cancellation transactions", () => {
  const getDatabase = useMigratedDatabase();

  it("expires exactly at the instance period, refreshes on completed turns and sweeps orphaned owners/contexts", async () => {
    const database = getDatabase();
    const { service, alice, request, conversations } =
      await createAssistantHarness(database);
    const result = await service.run(alice, request);
    await database.execute(
      "UPDATE assistant_conversations SET last_message_at = utc_after(-INTERVAL 30 DAY);",
    );
    await conversations.sweep();
    expect(await conversations.messages(result.conversationId)).toEqual([]);
    const current = await service.run(alice, assistantRequest({ ...request }));
    await database.execute(
      "UPDATE assistant_conversations SET last_message_at = utc_after(-INTERVAL 29 DAY);",
    );
    await service.run(
      alice,
      assistantRequest({ ...request, conversationId: current.conversationId }),
    );
    expect(
      await database.query(
        "SELECT COUNT(*) FROM assistant_conversations WHERE last_message_at > utc_after(-INTERVAL 1 MINUTE);",
      ),
    ).toEqual([[1]]);
    await database.execute(
      "UPDATE assistant_conversations SET user_id = 'deleted-user';",
    );
    await conversations.sweep();
    expect(await conversations.messages(current.conversationId)).toEqual([]);
    await conversations.create(alice.id, {
      kind: "wiki",
      id: "deleted-page",
      version: "1",
    });
    await conversations.create(alice.id, {
      kind: "ticket",
      id: "deleted-ticket",
      version: "",
    });
    await conversations.sweep();
    expect(
      await database.query("SELECT COUNT(*) FROM assistant_conversations;"),
    ).toEqual([[0]]);
  });

  it("deletes project-ticket history and all soft-deleted wiki page history in the same transaction", async () => {
    const database = getDatabase();
    const { service, alice, request, conversations } =
      await createAssistantHarness(database);
    const wiki = await service.run(alice, request);
    const ticket = await service.run(
      alice,
      assistantRequest({
        context: { kind: "ticket", id: "ticket", version: "" },
      }),
    );
    await new ProjectLifecycleRepository(database).delete("project");
    expect(await conversations.messages(ticket.conversationId)).toEqual([]);
    await new WikiPageWriteRepository(database).markDeleted(
      request.context.id,
      alice.id,
    );
    expect(await conversations.messages(wiki.conversationId)).toEqual([]);
  });

  it("rolls back an aborted append before or during the transaction", async () => {
    const database = getDatabase();
    const { conversations, alice, request } =
      await createAssistantHarness(database);
    const id = await conversations.create(alice.id, request.context);
    const cancelled = new AbortController();
    cancelled.abort("cancelled");
    await expect(
      conversations.append(id, {
        instruction: "Question",
        text: "Answer",
        change: "answer",
        signal: cancelled.signal,
      }),
    ).rejects.toBe("cancelled");
    const delayed = new AbortController();
    const transaction = database.transaction.bind(database);
    vi.spyOn(database, "transaction").mockImplementationOnce((work) =>
      transaction((operations) =>
        work({
          query: operations.query,
          execute: async (sql, parameters) => {
            await operations.execute(sql, parameters);
            delayed.abort("cancelled");
          },
        }),
      ),
    );
    await expect(
      conversations.append(id, {
        instruction: "Question",
        text: "Answer",
        change: "answer",
        signal: delayed.signal,
      }),
    ).rejects.toBe("cancelled");
    expect(await conversations.messages(id)).toEqual([]);
    await conversations.append(id, {
      instruction: "Question",
      text: "Answer",
      change: "insert",
    });
    expect((await conversations.messages(id))[1].change).toBe("insert");
  });

  it("rejects corrupt stored message contracts and treats a partial assignment as missing", async () => {
    const database = getDatabase();
    const { conversations, settings } = await createAssistantHarness(database);
    for (const row of [
      ["m", "tool", "text", "answer", "now"],
      ["m", "user", "text", "delete", "now"],
    ]) {
      vi.spyOn(database, "query").mockResolvedValueOnce([row]);
      await expect(conversations.messages("c")).rejects.toThrow(
        "invalidOutput",
      );
    }
    vi.spyOn(database, "query").mockResolvedValueOnce([
      ["connection", null, null, 30],
    ]);
    expect((await settings.read()).role).toBeNull();
  });
});
