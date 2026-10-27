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

it("reports the refusal of a retired agent update to Pica and changes nothing", async () => {
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
      }),
      "Agents lassen sich nicht mehr ändern; die Konfiguration gehört in den Plan-Node.",
    ],
  );
  expect(answer.answer.content).toContain("Plan-Node");
  expect(chat.stored(id)).toMatchObject({
    name: "Synthetic reviewer",
    revision: 1,
    configuration: { parameters: PARAMETERS },
  });
  expect(chat.prompts[2].prompt).toContain('"operation":"agents.update"');
  expect(chat.prompts[2].prompt).toContain("operation_retired");
  expect(chat.prompts[2].prompt).not.toContain('"changed":true');
  expect(chat.prompts[0].instructions).toContain("abgelöst");
  expect(chat.prompts[0].instructions).toContain("operation_retired");
  expect(chat.prompts[0].instructions).not.toContain("überschreibe sie nicht");
});

it("creates no agent when Pica requests the retired create action", async () => {
  const reply = await chat.send("Erstelle einen Agent namens Synthese.", [
    modelAction("agents.models.list"),
    modelAction("agents.create", {
      name: "Synthese",
      instruction: "Summarize.",
    }),
    "Agents lassen sich nicht mehr erstellen.",
  ]);
  expect(reply.answer.content).toBe("Agents lassen sich nicht mehr erstellen.");
  expect(chat.world.storedAgents()).toEqual([]);
  expect(chat.prompts[2].prompt).toContain("operation_retired");
});

it.each(["de", "en"] as const)(
  "accepts LÖSCHEN as the typed confirmation with %s interface language and still refuses the retired deletion",
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
    expect(chat.prompts[2].prompt).not.toContain("CONFIRMATION_REQUIRED");
    expect(chat.prompts[2].prompt).toContain("operation_retired");
    expect(chat.world.storedAgents()).toHaveLength(1);
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
    "Ersten Agent geprüft; für den zweiten benötige ich erneut LÖSCHEN.",
  ]);
  expect(chat.prompts[2].prompt).toContain("operation_retired");
  expect(chat.prompts[2].prompt).toContain("CONFIRMATION_REQUIRED");
  expect(chat.world.storedAgents()).toHaveLength(2);
});

it("passes an authorization error back for a comprehensible explanation", async () => {
  const id = await chat.seed();
  vi.spyOn(chat.tools, "run").mockResolvedValueOnce({
    ok: false,
    error: "FORBIDDEN",
  });
  await chat.send("Zeige den Agent.", [
    modelAction("agents.read", { agentId: id }),
    "Mir fehlt die Berechtigung zum Lesen dieses Agents.",
  ]);
  expect(chat.prompts[1].prompt).toContain("FORBIDDEN");
  expect(chat.prompts[0].instructions).toContain("fehlende Berechtigung");
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

it("hands a long instruction to the model complete, together with the read revision and access facts", async () => {
  const id = await chat.seed();
  const source = chat.stored(id);
  if (!source.configuration) throw new Error("Missing synthetic configuration");
  const markdown = "Synthetic long instruction. ".repeat(1200);
  await chat.world.agents.save("igor", id, {
    ...source,
    configuration: { ...source.configuration, markdown },
  });
  await chat.send("Zeige den Agent.", [
    modelAction("agents.read", { agentId: id }),
    "Agent gelesen, Anweisung gekürzt.",
  ]);
  // A result is complete or refused; the history and attachments are the only texts cut for the prompt.
  expect(chat.prompts[1].prompt).not.toContain("[gekürzt]");
  expect(chat.prompts[1].prompt).toContain(markdown);
  expect(chat.prompts[1].prompt).toContain('"revision":2');
  expect(chat.prompts[1].prompt).toContain('"canEdit":true');
  expect(chat.stored(id).configuration?.markdown).toBe(markdown);
});
