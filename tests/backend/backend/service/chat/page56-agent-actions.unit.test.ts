import { beforeEach, expect, it, vi } from "vitest";

import {
  describeChatOperations,
  isChatOperation,
  isChatWriteOperation,
} from "@/backend/service/chat/ChatToolCatalog";

import { memoryFiles } from "../agents/page-agent-files";
import { ChatAgentWorld, PARAMETERS } from "./page56-chat-world";

vi.mock("node:fs/promises", async () => {
  const { memoryFilesModule } = await import("../agents/page-agent-files");
  return memoryFilesModule();
});

let chat: ChatAgentWorld;
beforeEach(() => {
  memoryFiles.reset();
  chat = new ChatAgentWorld();
});

it("describes the callable agent reads and hides the retired writes from the model", () => {
  for (const operation of [
    "agents.list",
    "agents.read",
    "agents.models.list",
  ] as const) {
    expect(isChatOperation(operation)).toBe(true);
    expect(isChatWriteOperation(operation)).toBe(false);
    expect(describeChatOperations()).toContain(`\`${operation}\``);
  }
  for (const operation of [
    "agents.create",
    "agents.update",
    "agents.clone",
    "agents.delete",
  ] as const) {
    // They stay chat operations, so a request is answered, but nothing offers them.
    expect(isChatOperation(operation)).toBe(true);
    expect(isChatWriteOperation(operation)).toBe(true);
    expect(describeChatOperations()).not.toContain(`\`${operation}\``);
  }
  expect(isChatOperation("agents.admin.takeOver")).toBe(false);
});

it("lists and reads only owned or currently shared definitions and their PAGE-55 configuration", async () => {
  const id = await chat.seed();
  expect(await chat.run("agents.list")).toMatchObject({
    ok: true,
    result: {
      total: 1,
      agents: [{ id, parameters: PARAMETERS, run: { timeoutMinutes: 17 } }],
    },
  });
  expect(
    await chat.run("agents.read", { agentId: id }, { userId: "member" }),
  ).toMatchObject({ ok: true, result: { agent: { id, canEdit: false } } });
  expect(
    await chat.run("agents.list", {}, { userId: "outsider" }),
  ).toMatchObject({ ok: true, result: { total: 0, agents: [] } });
  for (const agentId of [id, "missing"])
    expect(
      await chat.run("agents.read", { agentId }, { userId: "outsider" }),
    ).toMatchObject({ ok: false, error: "NOT_FOUND" });
  chat.world.removeGroup("builders");
  expect(
    await chat.run("agents.read", { agentId: id }, { userId: "member" }),
  ).toMatchObject({ ok: false, error: "NOT_FOUND" });
});

it.each([
  ["agents.create", { name: "Igor's synthetic agent", instruction: "Review." }],
  ["agents.update", { expectedRevision: 1, name: "Renamed" }],
  ["agents.clone", { expectedRevision: 1 }],
  ["agents.delete", { expectedRevision: 1 }],
] as const)(
  "answers the retired %s as refused for the owner and for a person who may only use the agent",
  async (operation, parameters) => {
    const id = await chat.seed();
    const before = JSON.stringify(chat.world.stored());
    const filesBefore = memoryFiles.files();
    for (const userId of ["igor", "member"])
      expect(
        await chat.run(
          operation,
          { agentId: id, ...parameters },
          { userId, confirmation: "LÖSCHEN" },
        ),
      ).toEqual({
        ok: false,
        error: "INVALID_REQUEST",
        details: { reason: "operation_retired" },
      });
    expect(JSON.stringify(chat.world.stored())).toBe(before);
    expect(memoryFiles.files()).toEqual(filesBefore);
  },
);

it("never exposes the retired clone and delete through the operation service of the MCP clients", async () => {
  await chat.seed();
  for (const operation of ["agents.clone", "agents.delete"])
    expect(
      await chat.world.operations.handle(
        chat.world.identity("igor"),
        operation,
        {},
      ),
    ).toBeNull();
  expect(chat.world.storedAgents()).toHaveLength(1);
});
