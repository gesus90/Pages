import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { AgentChatTaskRepository } from "@/backend/database/repositories/conversation/AgentChatTaskRepository";

const MIGRATION = path.resolve(
  "backend/database/postgres/migrations/063_agent_chat_tasks.sql",
);

/** The SQL with collapsed white space, so a test reads one statement as one line. */
async function migration(): Promise<string> {
  return (await readFile(MIGRATION, "utf8")).replace(/\s+/gu, " ");
}

describe("PAGE-392 tasks go with their chat", () => {
  it("binds a task to its group, whose deletion removes the binding, and the binding's removal its automation", async () => {
    const sql = await migration();
    expect(sql).toContain(
      "FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE",
    );
    expect(sql).toContain(
      "FOREIGN KEY (automation_id) REFERENCES automations (id) ON DELETE CASCADE",
    );
    expect(sql).toMatch(
      /CREATE TRIGGER agent_chat_tasks_remove_automation AFTER DELETE ON agent_chat_tasks FOR EACH ROW EXECUTE FUNCTION agent_chat_task_removed\(\);/u,
    );
    expect(sql).toMatch(
      /FUNCTION agent_chat_task_removed\(\).*DELETE FROM automations WHERE id = OLD\.automation_id;/u,
    );
  });

  it("removes the tasks of a direct chat when the person deletes that chat from their list", async () => {
    const sql = await migration();
    expect(sql).toMatch(
      /CREATE TRIGGER chat_contacts_remove_agent_chat_tasks AFTER DELETE ON chat_contacts FOR EACH ROW EXECUTE FUNCTION agent_chat_contact_removed\(\);/u,
    );
    expect(sql).toMatch(
      /DELETE FROM agent_chat_tasks WHERE chat_kind = 'direct' AND person_id = OLD\.owner_id AND agent_id = OLD\.contact_id;/u,
    );
  });

  it("stores the binding of a group task and of a direct task and selects the tasks of one chat", async () => {
    const execute = vi.fn(async () => undefined);
    const query = vi.fn(async () => [
      [
        "automation-1",
        "agent",
        "igor",
        "group",
        "group-1",
        null,
        "task",
        "Tickets prüfen",
        "Offene Tickets prüfen",
        "2026-11-15T13:00:00.000Z",
      ],
    ]);
    const repository = new AgentChatTaskRepository({ query, execute });
    await repository.insert({
      automationId: "automation-1",
      agentId: "agent",
      requesterId: "igor",
      chat: { kind: "group", conversationId: "group-1" },
      kind: "task",
      request: "Tickets prüfen",
      instruction: "Offene Tickets prüfen",
      createdAt: "2026-11-15T13:00:00.000Z",
    });
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO agent_chat_tasks"),
      expect.objectContaining({
        chat_kind: "group",
        conversation_id: "group-1",
        person_id: null,
      }),
    );
    const listed = await repository.listForChat(
      { kind: "group", conversationId: "group-1" },
      "agent",
    );
    expect(listed).toEqual([
      expect.objectContaining({
        automationId: "automation-1",
        chat: { kind: "group", conversationId: "group-1" },
        kind: "task",
      }),
    ]);
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining("AND agent_id = $agent_id"),
      { conversation_id: "group-1", agent_id: "agent" },
    );
    await repository.listForChat({ kind: "direct", personId: "igor" }, null);
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining("chat_kind = 'direct'"),
      { person_id: "igor" },
    );
    await repository.delete("automation-1");
    expect(execute).toHaveBeenLastCalledWith(
      expect.stringContaining("DELETE FROM agent_chat_tasks"),
      { automation_id: "automation-1" },
    );
  });
});
