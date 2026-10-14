import { beforeEach, expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";

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

it("clones a shared source with its complete configuration and the requesting person as new owner", async () => {
  const id = await chat.seed();
  const source = chat.stored(id);
  const beforeFiles = memoryFiles.files();
  const cloned = await chat.run(
    "agents.clone",
    { agentId: id, expectedRevision: 1 },
    { userId: "member" },
  );
  expect(cloned).toMatchObject({
    ok: true,
    result: { changed: true, revision: 1 },
  });
  const clone = chat.world.storedAgents().find((agent) => agent.id !== id);
  expect(clone?.id).not.toBe(id);
  expect(clone).toEqual({ ...source, id: clone?.id, ownerId: "member" });
  expect(chat.stored(id)).toEqual(source);
  expect(memoryFiles.files()).toHaveLength(beforeFiles.length + 1);
  expect(chat.tickets).toHaveBeenLastCalledWith("member", "ticket-1");
});

it("applies title, instruction and parameter overrides exclusively to the independent clone", async () => {
  const id = await chat.seed();
  const source = chat.stored(id);
  expect(
    await chat.run("agents.clone", {
      agentId: id,
      expectedRevision: 1,
      name: "Customized clone",
      instruction: "Review {{topic}}.",
      parameterChanges: [
        {
          action: "update",
          name: "topic",
          fields: { defaultValue: { type: "text", text: "Clone topic" } },
        },
        { action: "remove", name: "amount" },
      ],
    }),
  ).toMatchObject({ ok: true });
  const clone = chat.world.storedAgents().find((agent) => agent.id !== id);
  expect(clone).toMatchObject({
    name: "Customized clone",
    configuration: {
      markdown: "Review {{topic}}.",
      parameters: [
        {
          ...PARAMETERS[0],
          defaultValue: { type: "text", text: "Clone topic" },
        },
        PARAMETERS[2],
      ],
      tag: source.configuration?.tag,
      run: source.configuration?.run,
      sharing: source.configuration?.sharing,
    },
  });
  expect(chat.stored(id)).toEqual(source);
  expect(
    await chat.run("agents.update", {
      agentId: clone?.id,
      expectedRevision: 1,
      name: "Independent",
    }),
  ).toMatchObject({ ok: true });
  expect(chat.stored(id)).toEqual(source);
});

it("requires both a visible source and the requester's create/model access, including administrators", async () => {
  const id = await chat.seed();
  for (const userId of ["outsider", "admin"])
    expect(
      await chat.run(
        "agents.clone",
        { agentId: id, expectedRevision: 1 },
        { userId },
      ),
    ).toMatchObject({ ok: false, error: "NOT_FOUND" });
  chat.world.addModel("model", {
    targets: [{ kind: "person", targetId: "igor" }],
  });
  expect(
    await chat.run("agents.read", { agentId: id }, { userId: "member" }),
  ).toMatchObject({ ok: true });
  expect(
    await chat.run(
      "agents.clone",
      { agentId: id, expectedRevision: 1 },
      { userId: "member" },
    ),
  ).toMatchObject({
    ok: false,
    error: "INVALID_REQUEST",
    details: { reason: "model_unavailable" },
  });
  expect(chat.world.storedAgents()).toHaveLength(1);
});

it("refuses stale clone sources and rechecks source changes between read and serialized save", async () => {
  const id = await chat.seed();
  expect(
    await chat.run("agents.clone", { agentId: id, expectedRevision: 2 }),
  ).toMatchObject({ ok: false, error: "CONFLICT" });
  const original = chat.world.agents.clone.bind(chat.world.agents);
  vi.spyOn(chat.world.agents, "clone").mockImplementationOnce(
    async (...args) => {
      chat.world.replace({
        ...chat.stored(id),
        revision: 2,
        name: "Concurrent edit",
      });
      return original(...args);
    },
  );
  expect(
    await chat.run("agents.clone", { agentId: id, expectedRevision: 1 }),
  ).toMatchObject({ ok: false, error: "CONFLICT" });
  expect(chat.world.storedAgents()).toHaveLength(1);
  expect(chat.stored(id).name).toBe("Concurrent edit");
});

it("rechecks source visibility lost between the read and clone save", async () => {
  const id = await chat.seed();
  const original = chat.world.agents.clone.bind(chat.world.agents);
  vi.spyOn(chat.world.agents, "clone").mockImplementationOnce(
    async (...args) => {
      chat.world.removeGroup("builders");
      return original(...args);
    },
  );
  expect(
    await chat.run(
      "agents.clone",
      { agentId: id, expectedRevision: 1 },
      { userId: "member" },
    ),
  ).toMatchObject({ ok: false, error: "NOT_FOUND" });
  expect(chat.world.storedAgents()).toHaveLength(1);
});

it("does not silently widen an AND share with a deleted target during cloning", async () => {
  const id = await chat.seed();
  const source = chat.stored(id);
  if (!source.configuration) throw new Error("Missing synthetic configuration");
  chat.world.replace({
    ...source,
    configuration: {
      ...source.configuration,
      sharing: {
        isGlobal: false,
        operator: "and",
        targets: [
          { kind: "group", targetId: "builders" },
          { kind: "group", targetId: "deleted" },
        ],
      },
    },
  });
  expect(
    await chat.run("agents.clone", { agentId: id, expectedRevision: 1 }),
  ).toMatchObject({
    ok: false,
    error: "INVALID_REQUEST",
    details: { reason: "sharing_changes_required" },
  });
  expect(
    await chat.run("agents.clone", {
      agentId: id,
      expectedRevision: 1,
      sharing: { scope: "private" },
    }),
  ).toMatchObject({ ok: true });
  expect(chat.stored(id).configuration?.sharing.targets).toHaveLength(2);
});

it("revalidates cloned ticket references and rolls back a failed clone journal", async () => {
  const id = await chat.seed();
  chat.tickets.mockRejectedValueOnce(
    new AgentError("parameter_ticket_unavailable"),
  );
  expect(
    await chat.run("agents.clone", { agentId: id, expectedRevision: 1 }),
  ).toMatchObject({
    ok: false,
    error: "INVALID_REQUEST",
    details: { reason: "parameter_reference_unavailable" },
  });
  const source = chat.stored(id);
  await expect(
    chat.world.agents.clone(
      "igor",
      { id, expectedRevision: 1 },
      source,
      async () => {
        throw new Error("Journal failed");
      },
    ),
  ).rejects.toThrow("Journal failed");
  expect(chat.world.storedAgents()).toHaveLength(1);
  expect(memoryFiles.files()).toHaveLength(1);
});

it("rejects model-injected confirmations and deletes only with the exact current German word", async () => {
  const id = await chat.seed();
  const parameters = {
    agentId: id,
    expectedRevision: 1,
    confirmation: "LÖSCHEN",
  };
  expect(await chat.run("agents.delete", parameters)).toMatchObject({
    ok: false,
    error: "CONFIRMATION_REQUIRED",
  });
  expect(
    await chat.run("agents.delete", parameters, { confirmation: "DELETE" }),
  ).toMatchObject({ ok: false, error: "CONFIRMATION_REQUIRED" });
  expect(
    await chat.run("agents.delete", parameters, { confirmation: "LÖSCHEN" }),
  ).toEqual({ ok: true, result: { id, deleted: true } });
  expect(chat.world.storedAgents()).toEqual([]);
  expect(chat.world.keys.size).toBe(1);
});

it("rejects non-owner deletion including administrators, stale revisions and running definitions", async () => {
  const id = await chat.seed();
  for (const userId of ["member", "outsider", "admin"])
    expect(
      await chat.run(
        "agents.delete",
        { agentId: id, expectedRevision: 1 },
        { userId, confirmation: "LÖSCHEN" },
      ),
    ).toMatchObject({ ok: false });
  expect(
    await chat.run(
      "agents.delete",
      { agentId: id, expectedRevision: 2 },
      { confirmation: "LÖSCHEN" },
    ),
  ).toMatchObject({ ok: false, error: "CONFLICT" });
  const release = await chat.world.files.hold([id]);
  expect(
    await chat.run(
      "agents.delete",
      { agentId: id, expectedRevision: 1 },
      { confirmation: "LÖSCHEN" },
    ),
  ).toMatchObject({
    ok: false,
    error: "CONFLICT",
    details: { reason: "agent_running" },
  });
  await release();
  chat.world.withdrawModel("model");
  expect(
    await chat.run(
      "agents.delete",
      { agentId: id, expectedRevision: 1 },
      { confirmation: "LÖSCHEN" },
    ),
  ).toMatchObject({ ok: true });
});

it("rechecks deletion revision after the read and keeps concurrent edits", async () => {
  const id = await chat.seed();
  const original = chat.world.agents.remove.bind(chat.world.agents);
  vi.spyOn(chat.world.agents, "remove").mockImplementationOnce(
    async (...args) => {
      chat.world.replace({ ...chat.stored(id), revision: 2 });
      return original(...args);
    },
  );
  expect(
    await chat.run(
      "agents.delete",
      { agentId: id, expectedRevision: 1 },
      { confirmation: "LÖSCHEN" },
    ),
  ).toMatchObject({ ok: false, error: "CONFLICT" });
  expect(chat.stored(id).revision).toBe(2);
});

it("refuses unknown or forged clone/delete parameters and never exposes clone/delete through the MCP operation service", async () => {
  const id = await chat.seed();
  for (const operation of ["agents.clone", "agents.delete"])
    for (const extra of [
      { ownerId: "other" },
      { expectedRevision: "1" },
      { agentId: "" },
    ])
      expect(
        await chat.run(
          operation,
          { agentId: id, expectedRevision: 1, ...extra },
          { confirmation: "LÖSCHEN" },
        ),
      ).toMatchObject({ ok: false, error: "INVALID_REQUEST" });
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

it("keeps the pinned source model unless a model change is explicitly requested", async () => {
  const id = await chat.seed();
  const source = chat.stored(id);
  chat.world.addModel("model", { model: "new-model" });
  expect(
    await chat.run("agents.clone", { agentId: id, expectedRevision: 1 }),
  ).toMatchObject({
    ok: false,
    error: "INVALID_REQUEST",
    details: { reason: "model_unavailable" },
  });
  expect(
    await chat.run("agents.update", {
      agentId: id,
      expectedRevision: 1,
      name: "Title only",
    }),
  ).toMatchObject({
    ok: false,
    error: "INVALID_REQUEST",
    details: { reason: "model_unavailable" },
  });
  expect(chat.stored(id)).toEqual(source);
  expect(
    await chat.run("agents.clone", {
      agentId: id,
      expectedRevision: 1,
      modelProfileId: "model",
    }),
  ).toMatchObject({ ok: true });
  expect(
    chat.world.storedAgents().find((agent) => agent.id !== id)?.model,
  ).toBe("new-model");
  expect(chat.stored(id)).toEqual(source);
});

it("rechecks the pinned clone model if a grant changes after the source read", async () => {
  const id = await chat.seed();
  const original = chat.world.agents.clone.bind(chat.world.agents);
  vi.spyOn(chat.world.agents, "clone").mockImplementationOnce(
    async (...args) => {
      chat.world.addModel("model", { model: "new-model" });
      return original(...args);
    },
  );
  expect(
    await chat.run("agents.clone", { agentId: id, expectedRevision: 1 }),
  ).toMatchObject({
    ok: false,
    error: "INVALID_REQUEST",
    details: { reason: "model_unavailable" },
  });
  expect(chat.world.storedAgents()).toHaveLength(1);
});

it("allows an explicitly adjusted reasoning effort while preserving the source's exact model", async () => {
  const id = await chat.seed();
  const source = chat.stored(id);
  chat.world.addModel("model", { efforts: ["low", "medium"] });
  expect(
    await chat.run("agents.clone", {
      agentId: id,
      expectedRevision: 1,
      reasoningEffort: "medium",
    }),
  ).toMatchObject({ ok: true });
  expect(
    chat.world.storedAgents().find((agent) => agent.id !== id),
  ).toMatchObject({
    model: source.model,
    reasoningEffort: "medium",
    configuration: source.configuration,
  });
  expect(chat.stored(id)).toEqual(source);
});
