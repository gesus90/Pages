import { beforeEach, expect, it, vi } from "vitest";

import { AgentOperationError } from "@/backend/error/AgentOperationError";

import { memoryFiles } from "../agents/page-agent-files";
import { ChatAgentWorld, modelAction, PARAMETERS } from "./page56-chat-world";

vi.mock("node:fs/promises", async () => {
  const { memoryFilesModule } = await import("../agents/page-agent-files");
  return memoryFilesModule();
});

let chat: ChatAgentWorld;
beforeEach(() => {
  memoryFiles.reset();
  chat = new ChatAgentWorld();
});

it("runs a read and combined update within one chat request and reports the actual outcomes to Pica", async () => {
  const id = await chat.seed();
  const answer = await chat.send(
    "Ändere Titel, Anweisung und Zahlenparameter des Agents.",
    [
      modelAction("agents.read", { agentId: id }),
      modelAction("agents.update", {
        agentId: id,
        expectedRevision: 1,
        name: "Changed",
        instruction: "Review {{topic}}.",
        parameterChanges: [
          {
            action: "update",
            name: "amount",
            fields: { defaultValue: { type: "number", number: 12.5 } },
          },
        ],
      }),
      "Agent geändert: Titel, Anweisung und Zahlenparameter; übrige Konfiguration erhalten.",
    ],
  );
  expect(answer.answer.content).toContain("Agent geändert");
  expect(chat.stored(id)).toMatchObject({
    name: "Changed",
    revision: 2,
    configuration: {
      markdown: "Review {{topic}}.",
      parameters: [
        PARAMETERS[0],
        { ...PARAMETERS[1], defaultValue: { type: "number", number: 12.5 } },
        PARAMETERS[2],
      ],
    },
  });
  expect(chat.prompts[2].prompt).toContain('"operation":"agents.update"');
  expect(chat.prompts[2].prompt).toContain('"changed":true,"revision":2');
  expect(chat.prompts[0].instructions).toContain(
    "nur auf ausdrücklichen Wunsch",
  );
  expect(chat.prompts[0].instructions).toContain(
    "überschreibe sie nicht automatisch",
  );
});

it("supports create_agent functionality through the Pages action protocol", async () => {
  const reply = await chat.send("Erstelle einen Agent namens Synthese.", [
    modelAction("agents.models.list"),
    modelAction("agents.create", {
      name: "Synthese",
      instruction: "Summarize.",
    }),
    "Agent Synthese erstellt.",
  ]);
  expect(reply.answer.content).toBe("Agent Synthese erstellt.");
  expect(chat.world.storedAgents()).toMatchObject([
    { name: "Synthese", ownerId: "igor" },
  ]);
  expect(chat.prompts[2].prompt).toContain('"ok":true');
});

it.each(["de", "en"] as const)(
  "accepts LÖSCHEN for agent deletion with %s interface language",
  async (language) => {
    const id = await chat.seed();
    const reply = await chat.send(
      "Entferne den genannten Agent. LÖSCHEN",
      [
        modelAction("agents.read", { agentId: id }),
        modelAction("agents.delete", { agentId: id, expectedRevision: 1 }),
        "Agent entfernt.",
      ],
      language,
    );
    expect(reply.answer.content).toBe("Agent entfernt.");
    expect(chat.prompts[2].prompt).toContain('"deleted":true');
    expect(chat.world.storedAgents()).toEqual([]);
  },
);

it.each([
  "DELETE",
  "löschen",
  "LÖSCHENxyz",
  "LÖSCHEN123",
  "LÖSCHEN_foo",
  "LÖSCHEN\u0308",
])(
  "does not treat %s as the required agent deletion confirmation",
  async (word) => {
    const id = await chat.seed();
    await chat.send(
      `Entferne den Agent: ${word}`,
      [
        modelAction("agents.delete", {
          agentId: id,
          expectedRevision: 1,
          confirmation: "LÖSCHEN",
        }),
        "Bitte bestätige mit LÖSCHEN.",
      ],
      "en",
    );
    expect(chat.prompts[1].prompt).toContain("CONFIRMATION_REQUIRED");
    expect(chat.world.storedAgents()).toHaveLength(1);
  },
);

it("does not reuse confirmation from an earlier message or model-supplied parameters", async () => {
  const id = await chat.seed();
  chat.messages.push({
    id: "old",
    role: "user",
    content: "LÖSCHEN",
    createdAt: "2026-10-13",
  });
  await chat.send("Entferne den Agent.", [
    modelAction("agents.delete", {
      agentId: id,
      expectedRevision: 1,
      confirmation: "LÖSCHEN",
    }),
    "Bitte bestätige mit LÖSCHEN.",
  ]);
  expect(chat.prompts[1].prompt).toContain("CONFIRMATION_REQUIRED");
  expect(chat.world.storedAgents()).toHaveLength(1);
});

it("consumes one typed confirmation even if Pica requests more than one agent deletion", async () => {
  const first = await chat.seed();
  const second = await chat.seed();
  await chat.send("Entferne die Agents. LÖSCHEN", [
    modelAction("agents.delete", { agentId: first, expectedRevision: 1 }),
    modelAction("agents.delete", { agentId: second, expectedRevision: 1 }),
    "Ersten Agent entfernt; für den zweiten benötige ich erneut LÖSCHEN.",
  ]);
  expect(chat.prompts[2].prompt).toContain('"deleted":true');
  expect(chat.prompts[2].prompt).toContain("CONFIRMATION_REQUIRED");
  expect(chat.world.storedAgents().map((agent) => agent.id)).toEqual([second]);
});

it("passes authorization errors and revision conflicts back for a comprehensible explanation", async () => {
  const id = await chat.seed();
  vi.spyOn(chat.tools, "run").mockResolvedValueOnce({
    ok: false,
    error: "FORBIDDEN",
  });
  await chat.send("Benenne den Agent um.", [
    modelAction("agents.update", {
      agentId: id,
      expectedRevision: 1,
      name: "Denied",
    }),
    "Mir fehlt die Berechtigung zum Ändern dieses Agents.",
  ]);
  expect(chat.prompts[1].prompt).toContain("FORBIDDEN");
  expect(chat.prompts[0].instructions).toContain("fehlende Berechtigung");
  await chat.send("Benenne den Agent um.", [
    modelAction("agents.update", {
      agentId: id,
      expectedRevision: 2,
      name: "Stale",
    }),
    "Der Agent wurde zwischenzeitlich geändert.",
  ]);
  expect(chat.prompts.at(-1)?.prompt).toContain('"error":"CONFLICT"');
  expect(chat.stored(id).name).toBe("Synthetic reviewer");
});

it("does not expose upstream diagnostics when an unexpected operation error occurs", async () => {
  const id = await chat.seed();
  const report = vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(chat.operations, "handle").mockRejectedValueOnce(
    new Error("Private upstream diagnostic"),
  );
  expect(await chat.run("agents.read", { agentId: id })).toEqual({
    ok: false,
    error: "FAILED",
  });
  expect(report).toHaveBeenCalledWith(
    "[pages] A chat action failed.",
    expect.objectContaining({
      type: "Error",
      message:
        "Error reported; free-form diagnostic text omitted to protect user content",
    }),
  );
  expect(JSON.stringify(report.mock.calls)).not.toContain(
    "Private upstream diagnostic",
  );
  vi.spyOn(chat.operations, "handle").mockRejectedValueOnce(
    new AgentOperationError("FORBIDDEN"),
  );
  expect(await chat.run("agents.read", { agentId: id })).toEqual({
    ok: false,
    error: "FORBIDDEN",
  });
});

it("keeps the read revision and access facts available when a long instruction is truncated for the model", async () => {
  const id = await chat.seed();
  const source = chat.stored(id);
  if (!source.configuration) throw new Error("Missing synthetic configuration");
  const markdown = "Synthetic long instruction. ".repeat(1200);
  await chat.world.agents.save("igor", id, {
    ...source,
    configuration: { ...source.configuration, markdown },
  });
  await chat.send("Ändere nur den Titel des Agents.", [
    modelAction("agents.read", { agentId: id }),
    modelAction("agents.update", {
      agentId: id,
      expectedRevision: 2,
      name: "Long agent renamed",
    }),
    "Titel geändert, Anweisung erhalten.",
  ]);
  expect(chat.prompts[1].prompt).toContain("[gekürzt]");
  expect(chat.prompts[1].prompt).toContain('"revision":2');
  expect(chat.prompts[1].prompt).toContain('"canEdit":true');
  expect(chat.stored(id).configuration?.markdown).toBe(markdown);
});
