import { beforeEach, expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import {
  describeChatOperations,
  isChatOperation,
  isChatWriteOperation,
} from "@/backend/service/chat/ChatToolCatalog";
import { renderAgentDefinition } from "@/backend/service/agents/AgentDefinitionFiles";

import { memoryFiles } from "../agents/page-agent-files";
import { AGENTS_DIRECTORY } from "../agents/page-agent-world";
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

function changedId(outcome: { readonly result?: unknown }): string {
  const result = outcome.result;
  if (
    typeof result !== "object" ||
    result === null ||
    !("id" in result) ||
    typeof result.id !== "string"
  )
    throw new Error("Expected mutation receipt");
  return result.id;
}

it("describes the callable agent actions and distinguishes reads from writes", () => {
  for (const operation of [
    "agents.list",
    "agents.read",
    "agents.models.list",
  ] as const) {
    expect(isChatOperation(operation)).toBe(true);
    expect(isChatWriteOperation(operation)).toBe(false);
  }
  for (const operation of [
    "agents.create",
    "agents.update",
    "agents.clone",
    "agents.delete",
  ] as const) {
    expect(isChatOperation(operation)).toBe(true);
    expect(isChatWriteOperation(operation)).toBe(true);
  }
  expect(describeChatOperations()).toContain("create_agent");
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

it("creates for Igor using his current grant and a server-owned operation identifier", async () => {
  expect(await chat.run("agents.models.list")).toMatchObject({
    ok: true,
    result: { models: [{ modelProfileId: "model", isDefault: true }] },
  });
  const created = await chat.run("agents.create", {
    operationId: "model-supplied",
    name: "Igor's synthetic agent",
    instruction: "Review.",
    parameters: PARAMETERS,
  });
  expect(created).toMatchObject({
    ok: true,
    result: { changed: true, revision: 1 },
  });
  expect(chat.stored(changedId(created))).toMatchObject({
    ownerId: "igor",
    modelProfileId: "model",
  });
  expect([...chat.world.keys.keys()]).not.toContain("igor/model-supplied");
  expect(chat.verify).toHaveBeenCalledTimes(2);
  for (const field of ["ownerId", "userId", "connectionId"])
    expect(
      await chat.run("agents.create", { name: "Forged", [field]: "admin" }),
    ).toMatchObject({ ok: false, error: "INVALID_REQUEST" });
  expect(chat.world.storedAgents()).toHaveLength(1);
});

it.each(["instruction", "name"] as const)(
  "changes only %s and retains every unrelated stored field",
  async (field) => {
    const id = await chat.seed();
    const before = chat.stored(id);
    const text =
      field === "instruction" ? "New AGENT.md instruction." : "New title";
    expect(
      await chat.run("agents.update", {
        agentId: id,
        expectedRevision: 1,
        [field]: text,
      }),
    ).toMatchObject({ ok: true, result: { changed: true, revision: 2 } });
    expect(chat.stored(id)).toEqual({
      ...before,
      revision: 2,
      name: field === "name" ? text : before.name,
      configuration:
        field === "instruction"
          ? { ...before.configuration, markdown: text }
          : before.configuration,
    });
    expect(memoryFiles.read(`${AGENTS_DIRECTORY}/${id}/AGENT.md`)).toBe(
      renderAgentDefinition(chat.stored(id)),
    );
  },
);

it.each(PARAMETERS)(
  "adds, edits and removes a $type parameter while retaining its neighbours and unmentioned fields",
  async (parameter) => {
    const id = await chat.seed();
    const added = { ...parameter, name: "extra" };
    const cases = [
      { action: "add", parameter: added },
      { action: "update", name: "extra", fields: { description: "Changed" } },
      { action: "remove", name: "extra" },
    ];
    const before = chat.stored(id);
    for (const [index, change] of cases.entries()) {
      expect(
        await chat.run("agents.update", {
          agentId: id,
          expectedRevision: index + 1,
          parameterChanges: [change],
        }),
      ).toMatchObject({ ok: true });
      const parameters = chat.stored(id).configuration?.parameters;
      expect(parameters?.slice(0, 3)).toEqual(PARAMETERS);
      if (index < 2)
        expect(parameters?.[3]).toEqual({
          ...added,
          description: index === 0 ? parameter.description : "Changed",
        });
    }
    expect(chat.stored(id)).toEqual({ ...before, revision: 4 });
  },
);

it("adds several PAGE-55 parameter types together without disturbing existing declarations", async () => {
  const id = await chat.seed();
  const additions = PARAMETERS.map((parameter) => ({
    ...parameter,
    name: `${parameter.name}Extra`,
  }));
  expect(
    await chat.run("agents.update", {
      agentId: id,
      expectedRevision: 1,
      parameterChanges: additions.map((parameter) => ({
        action: "add",
        parameter,
      })),
    }),
  ).toMatchObject({ ok: true, result: { revision: 2 } });
  expect(chat.stored(id).configuration?.parameters).toEqual([
    ...PARAMETERS,
    ...additions,
  ]);
});

it("records a delta that already matches without rewriting or advancing the definition", async () => {
  const id = await chat.seed();
  const before = chat.stored(id);
  expect(
    await chat.run("agents.update", {
      agentId: id,
      expectedRevision: 1,
      parameterChanges: [
        {
          action: "update",
          name: "topic",
          fields: { description: PARAMETERS[0].description },
        },
      ],
    }),
  ).toMatchObject({ ok: true, result: { changed: false, revision: 1 } });
  expect(chat.stored(id)).toEqual(before);
});

it("combines title, instruction and mixed add/edit/remove parameter changes in one revision", async () => {
  const id = await chat.seed();
  const before = chat.stored(id);
  const instruction = "Review {{topic}} with {{count}} for {{ticket}}.";
  const parameterChanges = [
    {
      action: "update",
      name: "topic",
      fields: { defaultValue: { type: "text", text: "New topic" } },
    },
    { action: "remove", name: "amount" },
    {
      action: "add",
      parameter: {
        ...PARAMETERS[1],
        name: "count",
        defaultValue: { type: "number", number: -12.5 },
      },
    },
    {
      action: "update",
      name: "ticket",
      fields: {
        description: "Updated ticket",
        defaultValue: { type: "ticket", ticketId: "ticket-1" },
      },
    },
  ];
  expect(
    await chat.run("agents.update", {
      agentId: id,
      expectedRevision: 1,
      name: "Combined",
      instruction,
      parameterChanges,
    }),
  ).toMatchObject({ ok: true, result: { revision: 2 } });
  expect(chat.stored(id)).toMatchObject({
    name: "Combined",
    revision: 2,
    configuration: {
      markdown: instruction,
      parameters: [
        { ...PARAMETERS[0], defaultValue: { type: "text", text: "New topic" } },
        { ...PARAMETERS[2], description: "Updated ticket" },
        parameterChanges[2].parameter,
      ],
      run: before.configuration?.run,
      sharing: before.configuration?.sharing,
    },
  });
  expect(chat.tickets).toHaveBeenLastCalledWith("igor", "ticket-1");
});

it("removes multiple parameter types together when the requested instruction removes their placeholders", async () => {
  const id = await chat.seed();
  expect(
    await chat.run("agents.update", {
      agentId: id,
      expectedRevision: 1,
      instruction: "No parameters.",
      parameterChanges: PARAMETERS.map(({ name }) => ({
        action: "remove",
        name,
      })),
    }),
  ).toMatchObject({ ok: true });
  expect(chat.stored(id).configuration?.parameters).toEqual([]);
});

it("rejects malformed and ambiguous deltas or invalid final configuration atomically", async () => {
  const id = await chat.seed();
  const before = chat.stored(id);
  const batches = [
    [],
    [{ action: "replace", name: "topic" }],
    [{ action: "remove", name: "bad.name" }],
    [{ action: "update", name: "topic", fields: {} }],
    [{ action: "update", name: "topic", fields: { ownerId: "other" } }],
    [
      {
        action: "update",
        name: "amount",
        fields: { defaultValue: { type: "number", number: "4" } },
      },
    ],
    [
      {
        action: "update",
        name: "topic",
        fields: { defaultValue: { type: "ticket", ticketId: "ticket-1" } },
      },
    ],
    [{ action: "update", name: "topic", fields: { isRequired: "yes" } }],
    [
      { action: "remove", name: "topic" },
      { action: "remove", name: "topic" },
    ],
    [{ action: "remove", name: "topic" }],
  ];
  for (const parameterChanges of batches)
    expect(
      await chat.run("agents.update", {
        agentId: id,
        expectedRevision: 1,
        parameterChanges,
      }),
    ).toMatchObject({ ok: false, error: "INVALID_REQUEST" });
  expect(
    await chat.run("agents.update", {
      agentId: id,
      expectedRevision: 1,
      parameters: [],
      parameterChanges: [{ action: "remove", name: "topic" }],
    }),
  ).toMatchObject({ ok: false, error: "INVALID_REQUEST" });
  expect(chat.stored(id)).toEqual(before);
  expect(chat.world.keys.size).toBe(0);
});

it("refuses missing edit/remove targets, duplicate additions and stale revisions without partial writes", async () => {
  const id = await chat.seed();
  const before = chat.stored(id);
  for (const change of [
    { action: "add", parameter: PARAMETERS[0] },
    { action: "remove", name: "missing" },
    { action: "update", name: "missing", fields: { description: "Updated" } },
  ])
    expect(
      await chat.run("agents.update", {
        agentId: id,
        expectedRevision: 1,
        name: "Partial",
        parameterChanges: [change],
      }),
    ).toMatchObject({ ok: false, error: "CONFLICT" });
  expect(
    await chat.run("agents.update", {
      agentId: id,
      expectedRevision: 2,
      name: "Stale",
    }),
  ).toMatchObject({
    ok: false,
    error: "CONFLICT",
    details: { currentRevision: 1 },
  });
  expect(chat.stored(id)).toEqual(before);
});

it("rechecks ticket reference access and writes no fields after a revoked reference", async () => {
  const id = await chat.seed();
  const before = chat.stored(id);
  chat.tickets.mockRejectedValueOnce(
    new AgentError("parameter_ticket_unavailable"),
  );
  expect(
    await chat.run("agents.update", {
      agentId: id,
      expectedRevision: 1,
      name: "Denied",
      parameterChanges: [
        {
          action: "update",
          name: "ticket",
          fields: { defaultValue: { type: "ticket", ticketId: "ticket-1" } },
        },
      ],
    }),
  ).toMatchObject({
    ok: false,
    error: "INVALID_REQUEST",
    details: { reason: "parameter_reference_unavailable" },
  });
  expect(chat.stored(id)).toEqual(before);
});

it("checks fresh ownership and model grants and never inherits Pica or administrator privileges", async () => {
  const id = await chat.seed();
  for (const userId of ["member", "admin", "outsider"])
    expect(
      await chat.run(
        "agents.update",
        { agentId: id, expectedRevision: 1, name: "Taken" },
        { userId },
      ),
    ).toMatchObject({ ok: false });
  expect(
    await chat.run(
      "agents.create",
      { name: "No grant" },
      { userId: "outsider" },
    ),
  ).toMatchObject({ ok: false, error: "FORBIDDEN" });
  chat.world.withdrawModel("model");
  expect(await chat.run("agents.create", { name: "Revoked" })).toMatchObject({
    ok: false,
    error: "FORBIDDEN",
  });
  expect(
    await chat.run("agents.update", {
      agentId: id,
      expectedRevision: 1,
      name: "Revoked",
    }),
  ).toMatchObject({
    ok: false,
    error: "INVALID_REQUEST",
    details: { reason: "model_unavailable" },
  });
  chat.world.changePerson("igor", { isActive: false });
  await expect(chat.run("agents.list")).rejects.toMatchObject({
    code: "accessDenied",
  });
  expect(chat.world.storedAgents()).toHaveLength(1);
});
