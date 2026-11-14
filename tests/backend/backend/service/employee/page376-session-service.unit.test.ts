import { expect, it, vi } from "vitest";

import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import {
  AgentChatSessionService,
  agentChatSessionState,
} from "@/backend/service/employee/AgentChatSessionService";

import type { StoredAgentChatSession } from "@/backend/database/repositories/employee/AgentChatSessionRepository";
import type { AgentChatSessionServiceDependencies } from "@/backend/service/employee/AgentChatSessionService";
import type { User } from "@/definition/User";
import { partialStub } from "../../stub-fixture";

const agent: User = {
  id: "agent",
  username: "ed",
  displayName: "Ed",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
  isAgent: true,
};
const igor: User = {
  ...agent,
  id: "igor",
  displayName: "Igor",
  isAgent: false,
};

function session(
  fields: Partial<StoredAgentChatSession>,
): StoredAgentChatSession {
  return {
    sessionId: "s",
    agentId: "agent",
    kind: "group",
    chatId: "group",
    chatName: "Pages Team",
    isConfidential: false,
    deliveredSequence: 0,
    needsRestart: false,
    contextUsed: null,
    contextSize: null,
    tokensTotal: 0,
    tokensToday: 0,
    tokensDay: null,
    restartCount: 0,
    lastActivityAt: null,
    ...fields,
  };
}

const STORED: readonly StoredAgentChatSession[] = [
  session({
    sessionId: "s-team",
    chatId: "team",
    chatName: "Pages Team",
    contextUsed: 58,
    contextSize: 100,
    tokensTotal: 151_000,
    lastActivityAt: "2026-03-04T10:00:00.000Z",
  }),
  session({
    sessionId: "s-igor",
    kind: "direct",
    chatId: "igor",
    chatName: "Igor",
    contextUsed: 34,
    contextSize: 100,
    tokensTotal: 96_000,
  }),
  session({
    sessionId: "s-gang",
    chatId: "gang",
    chatName: "Gang",
    contextUsed: 22,
    contextSize: 100,
  }),
  session({
    sessionId: "s-mei",
    kind: "direct",
    chatId: "mei",
    chatName: "Mei",
    contextUsed: 82,
    contextSize: 100,
    needsRestart: true,
  }),
  session({
    sessionId: "s-anton",
    kind: "direct",
    chatId: "anton",
    chatName: "Anton",
    isConfidential: true,
  }),
];

const POOL_STATES = new Map<string, "busy" | "idle">([
  ["s-team", "busy"],
  ["s-igor", "idle"],
]);

function fixture(
  settings: {
    idleMinutes: number | null;
    restartPercent: number;
  } | null = null,
): {
  readonly service: AgentChatSessionService;
  readonly lifecycle: Record<
    "stop" | "summarize" | "restart",
    ReturnType<typeof vi.fn>
  >;
  readonly saveSettings: ReturnType<typeof vi.fn>;
  readonly setNeedsRestart: ReturnType<typeof vi.fn>;
} {
  const lifecycle = {
    stop: vi.fn(async () => undefined),
    summarize: vi.fn(async () => true),
    restart: vi.fn(async () => undefined),
  };
  const saveSettings = vi.fn(async () => true);
  const setNeedsRestart = vi.fn(async () => undefined);
  const chatSessions = {
    list: vi.fn(async () => STORED),
    find: vi.fn(
      async (id: string) =>
        STORED.find((entry) => entry.sessionId === id) ?? null,
    ),
    tokensOn: vi.fn(async () => 539_000),
    settings: vi.fn(async () => settings),
    saveSettings,
    setNeedsRestart,
    forChat: vi.fn(async () => [STORED[0]]),
  };
  const dependencies = partialStub<AgentChatSessionServiceDependencies>({
    store: {
      chatSessions: () => chatSessions,
      conversations: () => ({
        find: vi.fn(async () => ({ sessionId: "s-igor" })),
      }),
    },
    users: {
      findById: vi.fn(async (id: string) => (id === "agent" ? agent : null)),
    },
    lifecycle,
    // Two sessions hold a live process: the team group and the direct chat of Igor.
    pool: {
      stateOf: (id: string) => POOL_STATES.get(id) ?? null,
    },
    isWorking: async (worker: User, id: string) => id === "s-team",
    waitingMessages: async (worker: User, entry: StoredAgentChatSession) =>
      entry.sessionId === "s-team" ? 2 : 0,
    isMember: async (conversationId: string, userId: string) =>
      userId === "igor" && conversationId === "team",
    defaultIdleMinutes: async () => 30,
    now: () => new Date("2026-03-04T12:00:00.000Z"),
  });
  const service = new AgentChatSessionService(dependencies);
  return { service, lifecycle, saveSettings, setNeedsRestart };
}

const ADMINISTRATOR = { user: igor, isAdministrator: true };
const MEMBER = { user: igor, isAdministrator: false };

it("tells the state of a session from what runs, what lives and what is full", () => {
  expect(
    agentChatSessionState({
      isWorking: true,
      hasProcess: true,
      needsRestart: true,
    }),
  ).toBe("working");
  expect(
    agentChatSessionState({
      isWorking: false,
      hasProcess: true,
      needsRestart: true,
    }),
  ).toBe("restart_needed");
  expect(
    agentChatSessionState({
      isWorking: false,
      hasProcess: true,
      needsRestart: false,
    }),
  ).toBe("ready");
  expect(
    agentChatSessionState({
      isWorking: false,
      hasProcess: false,
      needsRestart: false,
    }),
  ).toBe("resting");
});

it("shows an administrator every session of an agent with state, fill and waiting messages", async () => {
  const overview = await fixture().service.overview(ADMINISTRATOR, "agent");
  expect(
    overview.sessions.map((entry) => [
      entry.chat.name,
      entry.state,
      entry.contextPercent,
      entry.waitingMessages,
    ]),
  ).toEqual([
    ["Pages Team", "working", 58, 2],
    ["Igor", "ready", 34, 0],
    ["Gang", "resting", 22, 0],
    ["Mei", "restart_needed", 82, 0],
    ["Anton", "resting", null, 0],
  ]);
  expect(overview.sessions[4]?.chat).toMatchObject({
    kind: "direct",
    isConfidential: true,
  });
  expect(overview).toMatchObject({
    openSessions: 2,
    restingSessions: 3,
    tokensToday: 539_000,
    canChangeSettings: true,
    settings: { idleMinutes: 30, restartPercent: 80 },
  });
});

it("shows everybody else only the sessions of the chats they take part in", async () => {
  const overview = await fixture().service.overview(MEMBER, "agent");
  expect(overview.sessions.map((entry) => entry.chat.name)).toEqual([
    "Pages Team",
    "Igor",
  ]);
  expect(overview.canChangeSettings).toBe(false);
});

it("shows the settings of the agent before the default of the instance", async () => {
  const overview = await fixture({
    idleMinutes: 45,
    restartPercent: 70,
  }).service.overview(ADMINISTRATOR, "agent");
  expect(overview.settings).toEqual({ idleMinutes: 45, restartPercent: 70 });
});

it("refuses an account that is no agent", async () => {
  await expect(
    fixture().service.overview(ADMINISTRATOR, "igor"),
  ).rejects.toMatchObject({ code: "notFound" });
});

it("saves the idle time and the threshold of an agent for an administrator only, within their ranges", async () => {
  const { service, saveSettings } = fixture();
  await service.saveSettings(ADMINISTRATOR, "agent", {
    idleMinutes: "20",
    restartPercent: "75",
  });
  expect(saveSettings).toHaveBeenCalledWith("agent", {
    idleMinutes: 20,
    restartPercent: 75,
  });
  await expect(
    service.saveSettings(MEMBER, "agent", {
      idleMinutes: 20,
      restartPercent: 75,
    }),
  ).rejects.toMatchObject({ code: "forbidden" });
  for (const input of [
    { idleMinutes: 0, restartPercent: 80 },
    { idleMinutes: 1441, restartPercent: 80 },
    { idleMinutes: 30, restartPercent: 9 },
    { idleMinutes: 30, restartPercent: 96 },
    { idleMinutes: "abc", restartPercent: 80 },
  ])
    await expect(
      service.saveSettings(ADMINISTRATOR, "agent", input),
    ).rejects.toBeInstanceOf(AgentEmployeeError);
  expect(saveSettings).toHaveBeenCalledOnce();
});

it("stops, summarizes and restarts a session the viewer sees, and none other", async () => {
  const { service, lifecycle, setNeedsRestart } = fixture();
  await service.act(MEMBER, "stop", "s-team");
  expect(lifecycle.stop).toHaveBeenCalledWith(agent, "s-team");
  await service.act(MEMBER, "summarize", "s-igor");
  await vi.waitFor(() =>
    expect(lifecycle.summarize).toHaveBeenCalledWith(agent, "s-igor"),
  );
  await service.act(MEMBER, "restart", "s-team");
  // The overview shows "Neustart nötig" until the restart is done.
  expect(setNeedsRestart).toHaveBeenCalledWith("s-team", true);
  await vi.waitFor(() =>
    expect(lifecycle.restart).toHaveBeenCalledWith(agent, "s-team"),
  );
  await expect(service.act(MEMBER, "stop", "s-mei")).rejects.toMatchObject({
    code: "notFound",
  });
  await expect(service.act(MEMBER, "stop", "unbekannt")).rejects.toMatchObject({
    code: "notFound",
  });
  await service.act(ADMINISTRATOR, "stop", "s-mei");
  expect(lifecycle.stop).toHaveBeenCalledTimes(2);
});

it("shows the head of a chat the short state of each agent's session", async () => {
  const { service } = fixture();
  const group = await service.groupBriefs("team", () => ({
    isWorking: true,
    waitingMessages: 2,
  }));
  expect(group).toEqual([
    {
      sessionId: "s-team",
      agentId: "agent",
      state: "working",
      contextPercent: 58,
      waitingMessages: 2,
    },
  ]);
  const direct = await service.directBrief("agent", "igor", {
    isWorking: false,
    waitingMessages: 0,
  });
  expect(direct).toMatchObject({
    sessionId: "s-igor",
    state: "ready",
    contextPercent: 34,
  });
});
