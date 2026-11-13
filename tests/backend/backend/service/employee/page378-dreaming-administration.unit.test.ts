import { expect, it, vi } from "vitest";

import { AgentDreamingAdministration } from "@/backend/service/employee/AgentDreamingAdministration";
import { toDatabaseTime } from "@/backend/service/employee/AgentEmployeeText";
import { AGENT_DREAM_DEFAULT_SCHEDULE } from "@/definition/AgentDreaming";

import type { StoredAgentEmployee } from "@/backend/database/repositories/employee/AgentEmployeeRepository";
import type { StoredAgentDreaming } from "@/backend/database/repositories/employee/AgentDreamingRepository";
import type { AgentChatSessionViewer } from "@/backend/service/employee/AgentChatSessionService";
import type { AgentDreamSchedule } from "@/definition/AgentDreaming";
import type { PageAgentModel } from "@/definition/PageAgent";
import type { User } from "@/definition/User";

const ADMIN: AgentChatSessionViewer = {
  user: { id: "admin", displayName: "Ada" } as User,
  isAdministrator: true,
};
const MEMBER: AgentChatSessionViewer = {
  user: { id: "igor", displayName: "Igor" } as User,
  isAdministrator: false,
};
const CHEAP = {
  id: "cheap",
  connectionId: "cheap-connection",
  model: "cheap-model",
  name: "Cheap Model",
} as unknown as PageAgentModel;
const OWN = {
  id: "own",
  connectionId: "conn",
  model: "model",
  name: "Claude Sonnet 5.5",
} as unknown as PageAgentModel;

const NOW = new Date("2026-11-13T10:00:00.000Z");

function world(
  overrides: {
    employee?: Partial<StoredAgentEmployee>;
    dreaming?: Partial<StoredAgentDreaming>;
    isWorking?: boolean;
    learning?: boolean;
  } = {},
) {
  let employee = {
    userId: "ed",
    connectionId: "conn",
    model: "model",
    memory: "## Thema\n- Datum: 2026-11-01",
    dream:
      "- Eine Lektion. — Beleg: Test · Datum: 2026-11-01 · Stärke: 2\n- Noch eine. — Beleg: Test · Datum: 2026-11-02 · Stärke: 1",
    memoryCharacters: 8_000,
    dreamCharacters: 4_000,
    createdAt: toDatabaseTime(new Date("2026-11-01T10:00:00.000Z")),
    lastLearningAt: toDatabaseTime(new Date("2026-11-13T02:00:00.000Z")),
    lastLearningResult: null,
    dreamSchedule: AGENT_DREAM_DEFAULT_SCHEDULE,
    dreamRequest: null,
    ...overrides.employee,
  } as unknown as StoredAgentEmployee;
  let dreaming = {
    agentId: "ed",
    schedule: employee.dreamSchedule,
    model: null,
    lastRunAt: employee.lastLearningAt,
    createdAt: employee.createdAt,
    request: null,
    logbookThrough: 5,
    toolsThrough: 7,
    lastRun: {
      at: "2026-11-13T02:00:00.000Z",
      status: "updated",
      trigger: "schedule",
      errorCode: null,
      counts: { memoryTaken: 1 },
      log: [{ kind: "memoryTaken", text: "Release" }],
    },
    ...overrides.dreaming,
  } as unknown as StoredAgentDreaming;
  const saveSchedule = vi.fn(
    async (
      _agent: string,
      change: { schedule: AgentDreamSchedule; model: unknown },
    ) => {
      employee = {
        ...employee,
        dreamSchedule: change.schedule,
      } as StoredAgentEmployee;
      dreaming = {
        ...dreaming,
        schedule: change.schedule,
        model: change.model,
      } as StoredAgentDreaming;
      return true;
    },
  );
  const request = vi.fn(async () => "started" as const);
  const service = new AgentDreamingAdministration({
    store: {
      employees: () => ({ find: async () => employee }),
      dreaming: () => ({ find: async () => dreaming, saveSchedule }),
      logbook: () => ({
        settings: async () => ({ limit: 200 }),
        count: async () => 170,
      }),
      sessionSettings: () => ({ read: async () => ({ dreamTime: "03:00" }) }),
    } as never,
    users: {
      findById: async (id: string) =>
        id === "ed"
          ? ({
              id: "ed",
              displayName: "Ed",
              isAgent: true,
              isActive: true,
            } as User)
          : null,
    },
    learning:
      overrides.learning === false ? null : { request, isRunning: () => false },
    isWorkingInChat: () => overrides.isWorking ?? false,
    models: async () => [OWN, CHEAP],
    now: () => NOW,
  });
  return { service, saveSchedule, request, employee: () => employee };
}

function form(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    enabled: "true",
    interval: "1",
    unit: "days",
    time: "",
    weekday: "",
    onFullLogbook: "true",
    modelConnectionId: "",
    model: "",
    ...overrides,
  };
}

it("saves every rhythm from every hour to every 30 days and shows the next run for it", async () => {
  const { service } = world();
  const cases: [Record<string, unknown>, Partial<AgentDreamSchedule>][] = [
    [
      { interval: "1", unit: "hours" },
      { interval: 1, unit: "hours", time: null },
    ],
    [
      { interval: "6", unit: "hours", time: "02:00" },
      { interval: 6, unit: "hours", time: null },
    ],
    [
      { interval: "1", unit: "days", time: "02:00" },
      { interval: 1, unit: "days", time: "02:00" },
    ],
    [
      { interval: "7", unit: "days", time: "02:00", weekday: "1" },
      { interval: 7, unit: "days", time: "02:00", weekday: 1 },
    ],
    [
      { interval: "30", unit: "days", time: "02:00" },
      { interval: 30, unit: "days", time: "02:00", weekday: null },
    ],
    // A weekday only belongs to an interval of 7 days.
    [
      { interval: "3", unit: "days", time: "02:00", weekday: "2" },
      { interval: 3, weekday: null },
    ],
  ];
  for (const [input, expected] of cases) {
    await service.saveSettings(ADMIN, "ed", form(input));
    const overview = await service.overview(ADMIN, "ed");
    expect(overview.schedule).toMatchObject(expected);
    expect(overview.nextRunAt).not.toBeNull();
  }
  // The last case: every 3 days at 02:00 counted from the run of 13 November at 02:00.
  const last = await service.overview(ADMIN, "ed");
  expect(new Date(last.nextRunAt ?? "").getTime()).toBeGreaterThan(
    NOW.getTime(),
  );
});

it("shows the next run counted from the last one: every 30 days at 02:00", async () => {
  const { service } = world({
    employee: { lastLearningAt: toDatabaseTime(new Date(2026, 10, 13, 2, 0)) },
  });
  await service.saveSettings(
    ADMIN,
    "ed",
    form({ interval: "30", unit: "days", time: "02:00" }),
  );
  const overview = await service.overview(ADMIN, "ed");
  expect(overview.nextRunAt).toBe(new Date(2026, 11, 13, 2, 0).toISOString());
  expect(overview.instanceTime).toBe("03:00");
});

it("refuses a schedule outside its ranges and a model the administrator may not choose", async () => {
  const { service, saveSchedule } = world();
  for (const input of [
    { interval: "0", unit: "hours" },
    { interval: "721", unit: "hours" },
    { interval: "31", unit: "days" },
    { interval: "1", unit: "weeks" },
    { interval: "1", unit: "days", time: "25:00" },
    { interval: "7", unit: "days", weekday: "9" },
    { modelConnectionId: "c", model: "" },
    { modelConnectionId: "other", model: "unknown" },
  ])
    await expect(
      service.saveSettings(ADMIN, "ed", form(input)),
    ).rejects.toMatchObject({ code: "invalidInput" });
  expect(saveSchedule).not.toHaveBeenCalled();

  await service.saveSettings(
    ADMIN,
    "ed",
    form({ modelConnectionId: "cheap-connection", model: "cheap-model" }),
  );
  expect(saveSchedule).toHaveBeenCalledWith(
    "ed",
    expect.objectContaining({
      model: { connectionId: "cheap-connection", model: "cheap-model" },
    }),
  );
});

it("lets only an administrator save the schedule and start a run, and refuses an account that is no agent", async () => {
  const { service, request } = world();
  await expect(
    service.saveSettings(MEMBER, "ed", form()),
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(service.runNow(MEMBER, "ed")).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(
    service.saveSettings(ADMIN, "someone", form()),
  ).rejects.toMatchObject({ code: "notFound" });
  await expect(service.overview(ADMIN, "someone")).rejects.toMatchObject({
    code: "notFound",
  });
  expect(request).not.toHaveBeenCalled();
});

it("starts a run on request, and reports that it waits while the agent works in a chat", async () => {
  const { service, request } = world();
  expect(await service.runNow(ADMIN, "ed")).toBe("started");
  expect(request).toHaveBeenCalledWith("ed", "manual");
  request.mockResolvedValueOnce("waiting" as never);
  expect(await service.runNow(ADMIN, "ed")).toBe("waiting");
  await expect(
    world({ learning: false }).service.runNow(ADMIN, "ed"),
  ).rejects.toMatchObject({ code: "unavailable" });
});

it("shows the last and the next run, the log, the sizes and the files to an administrator", async () => {
  const { service } = world();
  const overview = await service.overview(ADMIN, "ed");
  expect(overview).toMatchObject({
    agentName: "Ed",
    canChange: true,
    lastRun: {
      status: "updated",
      trigger: "schedule",
      log: [{ kind: "memoryTaken", text: "Release" }],
    },
    dream: { lessons: 2, limit: 4_000 },
    memory: { limit: 8_000 },
    logbook: { count: 170, fillPercent: 85, triggerPercent: 80 },
    ownModelLabel: "Claude Sonnet 5.5",
    isRunning: false,
    isWaiting: false,
  });
  expect(overview.files?.memory).toContain("## Thema");
  expect(overview.models.map((model) => model.label)).toEqual([
    "Claude Sonnet 5.5",
    "Cheap Model",
  ]);
});

it("hides the log, the files and the models from everybody else and still shows the schedule", async () => {
  const overview = await world().service.overview(MEMBER, "ed");
  expect(overview.canChange).toBe(false);
  expect(overview.files).toBeNull();
  expect(overview.models).toEqual([]);
  expect(overview.lastRun).toMatchObject({ status: "updated", log: [] });
  expect(overview.schedule).toMatchObject({ interval: 1, unit: "days" });
  expect(overview.nextRunAt).not.toBeNull();
});

it("says a due run waits for the agent to leave its chats, and shows no next run while off", async () => {
  const due = world({
    employee: {
      lastLearningAt: toDatabaseTime(new Date("2026-11-10T02:00:00.000Z")),
    },
    isWorking: true,
  });
  expect((await due.service.overview(ADMIN, "ed")).isWaiting).toBe(true);
  const off = world({
    employee: {
      dreamSchedule: { ...AGENT_DREAM_DEFAULT_SCHEDULE, isEnabled: false },
    },
  });
  expect((await off.service.overview(ADMIN, "ed")).nextRunAt).toBeNull();
});

it("shows the stored result of an agent that dreamed before the log existed", async () => {
  const { service } = world({
    dreaming: { lastRun: null },
    employee: {
      lastLearningResult: {
        status: "updated",
        added: 2,
        merged: 1,
        archived: 0,
        removed: 3,
        errorCode: null,
      },
    },
  });
  const overview = await service.overview(ADMIN, "ed");
  expect(overview.lastRun).toMatchObject({
    status: "updated",
    trigger: null,
    counts: { lessonLearned: 2, lessonStrengthened: 1, lessonDropped: 3 },
    log: [],
  });
});
