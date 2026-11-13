import { expect, it, vi } from "vitest";

import { AgentLogbookScheduler } from "@/backend/service/employee/AgentLogbookScheduler";
import { AgentSessionMemoryModel } from "@/backend/service/employee/AgentMemoryModel";
import {
  createLogbookMessage,
  readLogbookAnswer,
} from "@/backend/service/employee/AgentLogbookPrompt";
import { AgentLogbookSummarizer } from "@/backend/service/employee/AgentLogbookSummarizer";

import { TEAM, logbookWorld, settings } from "./page377-logbook-fixture";

import type { PendingLogbookSession } from "@/backend/database/repositories/employee/AgentLogbookSessionRepository";
import type { AgentMemoryModel } from "@/backend/service/employee/AgentMemoryModel";
import type { User } from "@/definition/User";

const AGENT: User = {
  id: "ed",
  username: "ed",
  displayName: "Ed",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
  isAgent: true,
};
const EMPLOYEE = { userId: "ed", connectionId: "own-connection", model: "own-model" };

const PENDING: PendingLogbookSession = {
  sessionId: TEAM.sessionId,
  agentId: "ed",
  kind: "group",
  chatId: TEAM.chatId,
  chatName: TEAM.chatName,
  lastActivityAt: "2026-11-13T17:00:00.000Z",
  through: 10,
  quietMinutes: 2,
};

interface SummaryWorld {
  readonly summarizer: AgentLogbookSummarizer;
  readonly world: ReturnType<typeof logbookWorld>;
  readonly logbookModel: ReturnType<typeof vi.fn>;
  readonly read: ReturnType<typeof vi.fn>;
  readonly saveProgress: ReturnType<typeof vi.fn>;
}

function summaryWorld(options: {
  readonly pages?: readonly {
    messages: { nr: number; from: string; at: string; text: string }[];
    next: number | null;
  }[];
  readonly drafts?: unknown;
  readonly agentSettings?: ReturnType<typeof settings>;
  readonly instanceModel?: { connectionId: string; model: string } | null;
  readonly agent?: User | null;
} = {}): SummaryWorld {
  const world = logbookWorld([TEAM], options.agentSettings ?? settings());
  const pages = [...(options.pages ?? [])];
  const read = vi.fn(async () => pages.shift() ?? { messages: [], next: null });
  const logbookModel = vi.fn(async () =>
    "drafts" in options
      ? options.drafts
      : [
          { kind: "decision", text: "PAGE-370 übernimmt Ed bis Freitag." },
          { kind: "open", text: "Mei schreibt die Release-Notizen bis Mittwoch." },
        ],
  );
  const saveProgress = vi.fn(async () => undefined);
  const summarizer = new AgentLogbookSummarizer({
    store: {
      logbook: () => world.logbook,
      logbookSessions: () => ({ saveProgress }),
      employees: () => ({ find: async () => EMPLOYEE }),
    } as unknown as ConstructorParameters<typeof AgentLogbookSummarizer>[0]["store"],
    users: {
      findById: async () => (options.agent === undefined ? AGENT : options.agent),
    },
    reader: { read },
    model: () => ({ logbook: logbookModel }) as unknown as Pick<AgentMemoryModel, "logbook">,
    logbook: world.service,
    instanceModel: async () => options.instanceModel ?? null,
    now: () => new Date("2026-11-13T17:10:00.000Z"),
  });
  return { summarizer, world, logbookModel, read, saveProgress };
}

const MESSAGES = {
  messages: [
    { nr: 11, from: "Igor", at: "2026-11-13T16:58:00.000Z", text: "PAGE-370 macht Ed bis Freitag." },
    { nr: 12, from: "Mei", at: "2026-11-13T16:59:00.000Z", text: "Ich schreibe die Release-Notizen bis Mittwoch." },
  ],
  next: null,
};

it("adds the decisions and open tasks of a quiet chat to the Lagebuch as entries of the background summary", async () => {
  const { summarizer, world, logbookModel, read, saveProgress } = summaryWorld({
    pages: [MESSAGES],
  });
  world.logbook.participants.set("group:group-team", ["Igor", "Mei"]);

  await expect(summarizer.summarize(PENDING)).resolves.toEqual({
    status: "done",
    saved: 2,
  });

  // It read the chat after the position of the last summary.
  expect(read).toHaveBeenCalledWith(
    { sessionId: TEAM.sessionId, kind: "group", chatId: TEAM.chatId },
    "Ed",
    { ab: 10 },
  );
  // The model got the new messages and the chat's name.
  expect(logbookModel).toHaveBeenCalledWith(
    expect.objectContaining({ agent: AGENT }),
    {
      chat: "Gruppe „Pages-Team“",
      existing: [],
      messages: [
        { from: "Igor", at: "2026-11-13T16:58:00.000Z", text: "PAGE-370 macht Ed bis Freitag." },
        { from: "Mei", at: "2026-11-13T16:59:00.000Z", text: "Ich schreibe die Release-Notizen bis Mittwoch." },
      ],
    },
  );
  expect(world.logbook.entries.map((entry) => [entry.kind, entry.origin])).toEqual([
    ["decision", "background"],
    ["open", "background"],
  ]);
  expect(world.logbook.entries[0]).toMatchObject({
    source: { kind: "group", id: "group-team", name: "Pages-Team" },
    participants: ["Igor", "Mei"],
  });
  // The whole chat was read, so the session is done until its next round.
  expect(saveProgress).toHaveBeenCalledWith(TEAM.sessionId, {
    through: 12,
    processedAt: "2026-11-13T17:10:00.000Z",
  });
});

it("shows the model the entries the chat has already, so it adds only what is missing", async () => {
  const { summarizer, world, logbookModel } = summaryWorld({ pages: [MESSAGES] });
  await world.service.record(
    "ed",
    { kind: "group", id: TEAM.chatId, name: TEAM.chatName },
    [{ kind: "decision", text: "PAGE-370 übernimmt Ed bis Freitag." }],
    "agent",
  );
  await summarizer.summarize(PENDING);
  expect(logbookModel).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ existing: ["PAGE-370 übernimmt Ed bis Freitag."] }),
  );
  // The same decision is not written twice.
  expect(world.logbook.entries.filter((entry) => entry.kind === "decision")).toHaveLength(1);
});

it("names the person of a direct chat by name, not as person", async () => {
  const { summarizer, logbookModel } = summaryWorld({
    pages: [
      {
        messages: [{ nr: 1, from: "person", at: "2026-11-13T16:58:00.000Z", text: "Ich mag kurze Antworten." }],
        next: null,
      },
    ],
  });
  await summarizer.summarize({
    ...PENDING,
    kind: "direct",
    chatId: "person-igor",
    chatName: "Igor",
    through: 0,
  });
  expect(logbookModel).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      chat: "Direkt · Igor",
      messages: [expect.objectContaining({ from: "Igor" })],
    }),
  );
});

it("takes the model of the agent, else the one of the instance, else the agent's own", async () => {
  const own = summaryWorld({
    pages: [MESSAGES],
    agentSettings: settings({ connectionId: "agent-connection", model: "agent-cheap" }),
    instanceModel: { connectionId: "instance-connection", model: "instance-cheap" },
  });
  await own.summarizer.summarize(PENDING);
  expect(own.logbookModel).toHaveBeenCalledWith(
    expect.objectContaining({
      model: { connectionId: "agent-connection", model: "agent-cheap" },
    }),
    expect.anything(),
  );

  const instance = summaryWorld({
    pages: [MESSAGES],
    instanceModel: { connectionId: "instance-connection", model: "instance-cheap" },
  });
  await instance.summarizer.summarize(PENDING);
  expect(instance.logbookModel).toHaveBeenCalledWith(
    expect.objectContaining({
      model: { connectionId: "instance-connection", model: "instance-cheap" },
    }),
    expect.anything(),
  );

  const none = summaryWorld({ pages: [MESSAGES] });
  await none.summarizer.summarize(PENDING);
  const caller = none.logbookModel.mock.calls[0]?.[0] as { model?: unknown };
  expect(caller.model).toBeUndefined();
});

it("keeps a chat due when the model gives no usable answer, and writes nothing", async () => {
  const { summarizer, world, saveProgress } = summaryWorld({
    pages: [MESSAGES],
    drafts: null,
  });
  await expect(summarizer.summarize(PENDING)).resolves.toEqual({ status: "retry" });
  expect(world.logbook.entries).toHaveLength(0);
  expect(saveProgress).not.toHaveBeenCalled();
});

it("finishes a chat without new messages and an inactive agent without asking a model", async () => {
  const quiet = summaryWorld({ pages: [{ messages: [], next: null }] });
  await expect(quiet.summarizer.summarize(PENDING)).resolves.toEqual({
    status: "done",
    saved: 0,
  });
  expect(quiet.logbookModel).not.toHaveBeenCalled();
  expect(quiet.saveProgress).toHaveBeenCalledWith(TEAM.sessionId, {
    through: 10,
    processedAt: "2026-11-13T17:10:00.000Z",
  });

  const inactive = summaryWorld({ agent: { ...AGENT, isActive: false } });
  await inactive.summarizer.summarize(PENDING);
  expect(inactive.read).not.toHaveBeenCalled();
  expect(inactive.logbookModel).not.toHaveBeenCalled();
});

it("works off a long backlog over several runs: the chat stays due until it was read to its end", async () => {
  const page = (start: number, next: number | null) => ({
    messages: Array.from({ length: 20 }, (_, index) => ({
      nr: start + index,
      from: "Igor",
      at: "2026-11-13T16:00:00.000Z",
      text: `Nachricht ${String(start + index)}`,
    })),
    next,
  });
  const { summarizer, saveProgress, read } = summaryWorld({
    pages: [page(11, 30), page(31, 50), page(51, 70), page(71, 90), page(91, 110)],
  });
  await summarizer.summarize(PENDING);
  expect(read).toHaveBeenCalledTimes(5);
  // Read up to message 110 of an unfinished chat: the position moves, the session stays due.
  expect(saveProgress).toHaveBeenCalledWith(TEAM.sessionId, {
    through: 110,
    processedAt: null,
  });
});

it("never reads a confidential chat: the entries are refused and the chat is left to its own session", async () => {
  const { summarizer, world } = summaryWorld({ pages: [MESSAGES] });
  world.logbook.confidential.add("group:group-team");
  await expect(summarizer.summarize(PENDING)).resolves.toEqual({
    status: "done",
    saved: 0,
  });
  expect(world.logbook.entries).toHaveLength(0);
});

it("asks the model for entries in a fixed JSON form and reads its answer strictly", () => {
  const message = createLogbookMessage(
    "Gruppe „Pages-Team“",
    ["Alt"],
    [{ from: "Igor", at: "2026-11-13T16:58:00.000Z", text: "password=geheim123456 und mehr" }],
  );
  expect(message).toContain("Lagebuch-Ergänzung");
  expect(message).toContain('"eintraege"');
  expect(message).toContain('Vorhandene Einträge dieses Chats: ["Alt"]');
  expect(message).toContain("2026-11-13 16:58");
  expect(message).not.toContain("geheim123456");

  const answer = [
    "```json",
    JSON.stringify({
      eintraege: [
        { art: "Entscheidung", thema: "PAGE-370", text: "PAGE-370 macht Ed." },
        { art: "gerücht", text: "ungültige Art" },
        { art: "fakt", text: "" },
        "kein Objekt",
        { art: "aufgabe", text: "Mei prüft." },
      ],
    }),
    "```",
  ].join("\n");
  expect(readLogbookAnswer(answer)).toEqual([
    { kind: "decision", text: "PAGE-370 macht Ed.", topic: "PAGE-370" },
    { kind: "open", text: "Mei prüft." },
  ]);
  expect(readLogbookAnswer("Keine JSON-Antwort")).toBeNull();
  expect(readLogbookAnswer('{"eintraege": []}')).toEqual([]);
});

it("runs the model call as a short run of the agent's own on the chosen model, beside the chat sessions", async () => {
  const run = vi.fn(async () => ({
    start: { job: { id: "job" } },
    sessionId: "memory-session",
  }));
  const job = vi.fn(async () => ({ state: "completed" }));
  const model = new AgentSessionMemoryModel({
    sessions: {
      run,
      job,
      whenOutOfChats: async () => true,
    } as unknown as ConstructorParameters<typeof AgentSessionMemoryModel>[0]["sessions"],
    messages: {
      messages: async () => [
        {
          role: "assistant",
          content: '```json\n{"eintraege":[{"art":"fakt","text":"Der Testserver heißt staging-2."}]}\n```',
        },
      ],
    } as unknown as ConstructorParameters<typeof AgentSessionMemoryModel>[0]["messages"],
    wait: async () => undefined,
  });
  const drafts = await model.logbook(
    {
      agent: AGENT,
      employee: EMPLOYEE as never,
      model: { connectionId: "cheap-connection", model: "cheap" },
    },
    { chat: "Gruppe „Pages-Team“", existing: [], messages: [] },
  );
  expect(drafts).toEqual([{ kind: "fact", text: "Der Testserver heißt staging-2." }]);
  expect(run).toHaveBeenCalledWith(
    expect.objectContaining({
      purpose: "memory",
      person: null,
      modelOverride: { connectionId: "cheap-connection", model: "cheap" },
    }),
  );
  const request = run.mock.calls[0]?.[0] as unknown as { text: string };
  expect(request.text).toContain("Lagebuch-Ergänzung");
});

it("looks for quiet chats of agents that answer in no chat and summarizes each once", async () => {
  const sessions: PendingLogbookSession[] = [
    { ...PENDING, sessionId: "quiet", lastActivityAt: "2026-11-13T17:00:00.000Z" },
    { ...PENDING, sessionId: "recent", lastActivityAt: "2026-11-13T17:09:00.000Z" },
    { ...PENDING, sessionId: "busy", agentId: "busy-agent", lastActivityAt: "2026-11-13T16:00:00.000Z" },
    { ...PENDING, sessionId: "longer-quiet", quietMinutes: 30, lastActivityAt: "2026-11-13T17:00:00.000Z" },
  ];
  const summarize = vi.fn(async () => ({ status: "done" as const, saved: 1 }));
  let now = new Date("2026-11-13T17:10:00.000Z");
  const scheduler = new AgentLogbookScheduler({
    store: { logbookSessions: () => ({ pending: async () => sessions }) } as never,
    summarizer: { summarize },
    isWorking: (agentId) => agentId === "busy-agent",
    now: () => now,
  });
  await scheduler.runDue();
  // Ten minutes of quiet reach the two minutes of the default, not the 30 of the longer one;
  // the chat that was active a minute ago and the agent that answers elsewhere wait.
  expect(summarize.mock.calls.map(([session]) => (session as PendingLogbookSession).sessionId)).toEqual(["quiet"]);

  // Later the others are due.
  now = new Date("2026-11-13T17:35:00.000Z");
  summarize.mockClear();
  await scheduler.runDue();
  expect(
    summarize.mock.calls.map(([session]) => (session as PendingLogbookSession).sessionId),
  ).toEqual(["quiet", "recent", "longer-quiet"]);
});

it("tries a chat whose summary got no answer again only after ten minutes, and survives a failing run", async () => {
  const summarize = vi
    .fn()
    .mockResolvedValueOnce({ status: "retry" })
    .mockRejectedValueOnce(new Error("provider down"))
    .mockResolvedValue({ status: "done", saved: 0 });
  let now = new Date("2026-11-13T17:10:00.000Z");
  const scheduler = new AgentLogbookScheduler({
    store: { logbookSessions: () => ({ pending: async () => [PENDING] }) } as never,
    summarizer: { summarize },
    isWorking: () => false,
    now: () => now,
  });
  await scheduler.runDue();
  expect(summarize).toHaveBeenCalledTimes(1);
  now = new Date("2026-11-13T17:15:00.000Z");
  await scheduler.runDue();
  expect(summarize).toHaveBeenCalledTimes(1);
  now = new Date("2026-11-13T17:21:00.000Z");
  await scheduler.runDue();
  expect(summarize).toHaveBeenCalledTimes(2);
  now = new Date("2026-11-13T17:40:00.000Z");
  await scheduler.runDue();
  expect(summarize).toHaveBeenCalledTimes(3);
});

it("starts and stops its looking once", async () => {
  vi.useFakeTimers();
  try {
    const pending = vi.fn(async () => []);
    const scheduler = new AgentLogbookScheduler({
      store: { logbookSessions: () => ({ pending }) } as never,
      summarizer: { summarize: vi.fn() },
      isWorking: () => false,
    });
    scheduler.start();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(pending).toHaveBeenCalledTimes(1);
    await scheduler.shutdown();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pending).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
