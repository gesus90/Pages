import { expect, it, vi } from "vitest";

import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { AgentChatPrivacyService } from "@/backend/service/employee/AgentChatPrivacyService";
import { AgentLogbookAdministration } from "@/backend/service/employee/AgentLogbookAdministration";

import { IGOR, RELEASE, TEAM, logbookWorld, settings } from "./page377-logbook-fixture";

import type { PageAgentModel } from "@/definition/PageAgent";
import type { User } from "@/definition/User";

const igor: User = {
  id: "person-igor",
  username: "igor",
  displayName: "Igor",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};
const mei: User = { ...igor, id: "person-mei", username: "mei", displayName: "Mei" };
const ed: User = { ...igor, id: "ed", username: "ed", displayName: "Ed", isAgent: true };

const CHEAP = {
  id: "cheap",
  connectionId: "cheap-connection",
  model: "cheap-model",
  name: "Cheap Model · Claude",
} as unknown as PageAgentModel;

const WORLD_MEMBERS: Record<string, readonly string[]> = {
  "group-team": ["person-igor", "person-mei"],
  "group-release": ["person-mei"],
};

async function filled(): Promise<{
  readonly administration: AgentLogbookAdministration;
  readonly world: ReturnType<typeof logbookWorld>;
  readonly trim: ReturnType<typeof vi.fn>;
  readonly instanceModel: { value: { connectionId: string; model: string } | null };
}> {
  const world = logbookWorld([TEAM, IGOR, RELEASE], settings({ limit: 10 }));
  const tools = (session: { sessionId: string }) =>
    world.service.tools({ agentId: "ed", sessionId: session.sessionId });
  await tools(TEAM).remember({ art: "entscheidung", text: "PAGE-370 übernimmt Ed bis Freitag." });
  await tools(IGOR).remember({ art: "fakt", text: "Igor mag kurze Antworten." });
  await tools(RELEASE).remember({ art: "aufgabe", text: "Release-Notizen schreibt Mei." });
  const trim = vi.fn(async () => 0);
  const instanceModel: { value: { connectionId: string; model: string } | null } = {
    value: null,
  };
  const administration = new AgentLogbookAdministration({
    store: { logbook: () => world.logbook } as never,
    users: { findById: async (id: string) => (id === "ed" ? ed : null) },
    logbook: { trim },
    isMember: async (conversationId, userId) =>
      WORLD_MEMBERS[conversationId]?.includes(userId) ?? false,
    models: async () => [CHEAP],
    instanceModel: async () => instanceModel.value,
  });
  return { administration, world, trim, instanceModel };
}

const ADMIN = { user: mei, isAdministrator: true };
const IGOR_VIEWER = { user: igor, isAdministrator: false };

it("shows an administrator all entries with fill level, limit, quiet time and the models to choose from", async () => {
  const { administration, instanceModel } = await filled();
  instanceModel.value = { connectionId: "cheap-connection", model: "cheap-model" };
  const overview = await administration.overview(ADMIN, "ed");
  expect(overview).toMatchObject({
    agentId: "ed",
    agentName: "Ed",
    count: 3,
    fillPercent: 30,
    canChangeSettings: true,
    settings: { limit: 10, quietMinutes: 2, model: null },
    instanceModel: {
      connectionId: "cheap-connection",
      model: "cheap-model",
      label: "Cheap Model · Claude",
    },
    models: [
      {
        connectionId: "cheap-connection",
        model: "cheap-model",
        label: "Cheap Model · Claude",
      },
    ],
  });
  // The newest first, with kind, source, origin and time.
  expect(overview.entries.map((entry) => entry.text)).toEqual([
    "Release-Notizen schreibt Mei.",
    "Igor mag kurze Antworten.",
    "PAGE-370 übernimmt Ed bis Freitag.",
  ]);
  expect(overview.entries[2]).toMatchObject({
    kind: "decision",
    origin: "agent",
    topic: "PAGE-370 übernimmt Ed bis Freitag",
    source: { kind: "group", id: "group-team", name: "Pages-Team" },
    at: "2026-11-13T17:05:00.000Z",
  });
  expect(overview.chats.map((chat) => chat.name)).toEqual([
    "Release",
    "Igor",
    "Pages-Team",
  ]);
});

it("shows everybody else only the entries of the chats they take part in and no models", async () => {
  const { administration } = await filled();
  const igorView = await administration.overview(IGOR_VIEWER, "ed");
  // His direct chat and the group he is in, not the group of Mei alone.
  expect(igorView.entries.map((entry) => entry.source.id)).toEqual([
    "person-igor",
    "group-team",
  ]);
  expect(igorView.chats.map((chat) => chat.id)).toEqual(["person-igor", "group-team"]);
  expect(igorView).toMatchObject({ canChangeSettings: false, models: [], count: 3 });

  const meiView = await administration.overview({ user: mei, isAdministrator: false }, "ed");
  expect(meiView.entries.map((entry) => entry.source.id)).toEqual([
    "group-release",
    "group-team",
  ]);
});

it("does not list the entries of a confidential chat, not even to an administrator", async () => {
  const { administration, world } = await filled();
  world.logbook.confidential.add("direct:person-igor");
  const overview = await administration.overview(ADMIN, "ed");
  expect(overview.entries.map((entry) => entry.text)).not.toContain(
    "Igor mag kurze Antworten.",
  );
  expect(overview.chats.map((chat) => chat.id)).not.toContain("person-igor");
});

it("saves limit, quiet time and model of an agent and drops what the lowered limit pushes out", async () => {
  const { administration, world, trim } = await filled();
  await administration.saveSettings(ADMIN, "ed", {
    limit: "50",
    quietMinutes: "5",
    modelConnectionId: "cheap-connection",
    model: "cheap-model",
  });
  expect(world.logbook.settingsOf.get("ed")).toMatchObject({
    limit: 50,
    quietMinutes: 5,
    connectionId: "cheap-connection",
    model: "cheap-model",
  });
  expect(trim).toHaveBeenCalledWith("ed");

  // Empty fields give the model choice back to the instance.
  await administration.saveSettings(ADMIN, "ed", {
    limit: "50",
    quietMinutes: "5",
    modelConnectionId: "",
    model: "",
  });
  expect(world.logbook.settingsOf.get("ed")).toMatchObject({
    connectionId: null,
    model: null,
  });
});

it("refuses settings from a viewer who is no administrator, out of range, half a model or a model that may not be chosen", async () => {
  const { administration, world } = await filled();
  const valid = { limit: "50", quietMinutes: "5", modelConnectionId: "", model: "" };
  await expect(administration.saveSettings(IGOR_VIEWER, "ed", valid)).rejects.toMatchObject({
    code: "forbidden",
  });
  for (const input of [
    { ...valid, limit: "9" },
    { ...valid, limit: "2001" },
    { ...valid, limit: "abc" },
    { ...valid, quietMinutes: "0" },
    { ...valid, quietMinutes: "241" },
    { ...valid, modelConnectionId: "cheap-connection" },
    { ...valid, modelConnectionId: "other", model: "other-model" },
  ])
    await expect(administration.saveSettings(ADMIN, "ed", input)).rejects.toMatchObject({
      code: "invalidInput",
    });
  await expect(administration.saveSettings(ADMIN, "nobody", valid)).rejects.toMatchObject({
    code: "notFound",
  });
  expect(world.logbook.settingsOf.get("ed")?.limit).toBe(10);
});

it("lets a viewer remove entries they see and ignores the others", async () => {
  const { administration, world } = await filled();
  const ids = world.logbook.entries.map((entry) => entry.id);
  // Igor sees the decision of his group and his own chat, not the release group of Mei.
  const removed = await administration.remove(IGOR_VIEWER, "ed", ids);
  expect(removed).toBe(2);
  expect(world.logbook.entries.map((entry) => entry.source.id)).toEqual(["group-release"]);
  // An administrator removes what is left.
  expect(await administration.remove(ADMIN, "ed", [...ids, "unknown"])).toBe(1);
  expect(world.logbook.entries).toHaveLength(0);
});

it("refuses a malformed list of entries and an account that is no agent", async () => {
  const { administration } = await filled();
  await expect(administration.remove(ADMIN, "ed", [])).rejects.toMatchObject({
    code: "invalidInput",
  });
  await expect(administration.remove(ADMIN, "ed", "all")).rejects.toMatchObject({
    code: "invalidInput",
  });
  await expect(administration.overview(ADMIN, "person-igor")).rejects.toBeInstanceOf(
    AgentEmployeeError,
  );
  await expect(administration.overview(ADMIN, "nobody")).rejects.toMatchObject({
    code: "notFound",
  });
});

it("removes the entries of a chat from the Lagebuch when it is marked confidential, and keeps them when the mark goes", async () => {
  const world = logbookWorld([TEAM, IGOR, RELEASE]);
  const tools = (session: { sessionId: string }) =>
    world.service.tools({ agentId: "ed", sessionId: session.sessionId });
  await tools(TEAM).remember({ art: "fakt", text: "Teamfakt" });
  await tools(IGOR).remember({ art: "fakt", text: "Igors Fakt" });
  await tools(RELEASE).remember({ art: "fakt", text: "Releasefakt" });

  const chats = {
    setDirectConfidential: vi.fn(async () => undefined),
    setConversationConfidential: vi.fn(async () => undefined),
    conversationPeople: vi.fn(async () => ["person-igor"]),
  };
  const privacy = new AgentChatPrivacyService({
    store: {
      logbook: () => world.logbook,
      chats: () => chats,
      conversations: () => ({ ensure: vi.fn(async () => ({})) }),
    } as never,
    users: { findById: async () => ed },
    createSessionId: () => "new-session",
  });

  await privacy.setConfidential(igor, { agentId: "ed", isConfidential: "false" });
  expect(world.logbook.entries).toHaveLength(3);

  await privacy.setConfidential(igor, { agentId: "ed", isConfidential: "true" });
  expect(world.logbook.entries.map((entry) => entry.text)).toEqual([
    "Teamfakt",
    "Releasefakt",
  ]);

  await privacy.setConfidential(igor, {
    conversationId: "group-team",
    isConfidential: "true",
  });
  expect(world.logbook.entries.map((entry) => entry.text)).toEqual(["Releasefakt"]);
});
