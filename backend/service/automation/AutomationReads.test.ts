import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  jobsForRuns: vi.fn(),
  list: vi.fn(),
  find: vi.fn(),
  runFind: vi.fn(),
  runLatest: vi.fn(),
  runList: vi.fn(),
}));

vi.mock(
  "@/backend/database/repositories/automation/AutomationAgentJobRepository",
  () => ({
    AutomationAgentJobRepository: class {
      public forRuns = state.jobsForRuns;
    },
  }),
);
vi.mock(
  "@/backend/database/repositories/automation/AutomationRepository",
  () => ({
    AutomationRepository: class {
      public list = state.list;
      public find = state.find;
    },
  }),
);
vi.mock(
  "@/backend/database/repositories/automation/AutomationRunRepository",
  () => ({
    AutomationRunRepository: class {
      public find = state.runFind;
      public latest = state.runLatest;
      public list = state.runList;
    },
  }),
);

import { AutomationReads } from "./AutomationReads";
import { encodeAutomationCursor } from "./AutomationInput";

import type { Database } from "@/backend/database/Database";
import type { StoredAutomation } from "@/backend/database/repositories/automation/AutomationRepository";
import type { StoredAutomationRun } from "@/backend/database/repositories/automation/AutomationRunRepository";
import type { AutomationAccess } from "./AutomationAccess";
import type {
  AutomationAccount,
  AutomationDirectory,
} from "./AutomationDirectory";

function account(isAdministrator: boolean): AutomationAccount {
  return {
    id: "u1",
    displayName: "Ada",
    isAgent: false,
    isActive: true,
    isAdministrator,
    isReadOnly: false,
    timeZone: "Europe/Berlin",
    language: "en",
  };
}

function automation(id: string, creatorId = "u1"): StoredAutomation {
  return {
    id,
    creatorId,
    name: `Name ${id}`,
    trigger: { type: "manual" },
    action: { type: "plan", planId: "p" },
    sharing: { scope: "private" },
    isActive: true,
    deleteAfterSuccess: false,
    agentNotification: { mode: "off" },
    nextRunAt: null,
    revision: 1,
    createdAt: `created-${id}`,
    updatedAt: "u",
  };
}

function run(sequence: number, automationId = "a1"): StoredAutomationRun {
  return {
    id: `r${sequence}`,
    sequence,
    automationId,
    triggerKind: "manual",
    eventType: null,
    triggerSubject: null,
    triggerData: null,
    requestedBy: null,
    status: "queued",
    outcome: null,
    exitCode: null,
    forwardState: null,
    planRunId: null,
    planRunStatus: null,
    paused: false,
    errorCode: null,
    summary: null,
    answer: null,
    output: "out",
    error: null,
    queuedAt: "q",
    startedAt: null,
    endedAt: null,
  };
}

const PERMISSIONS = {
  canRead: true,
  canEdit: true,
  canRun: true,
  canDelete: true,
};

const access = {
  actor: vi.fn(),
  account: vi.fn(),
  permissions: vi.fn(),
  canSeeScript: vi.fn(),
};
const directory = {
  agents: vi.fn(),
  plans: vi.fn(),
  planSteps: vi.fn(),
  projects: vi.fn(),
  memberProjects: vi.fn(),
  groups: vi.fn(),
  workspaces: vi.fn(),
  interpreterProfiles: vi.fn(),
};
const database: Pick<Database, "query" | "execute"> = {
  query: vi.fn(),
  execute: vi.fn(),
};

function reads(): AutomationReads {
  return new AutomationReads({
    database,
    // The doubles implement only the members the reads call.
    access: access as unknown as AutomationAccess,
    directory: directory as unknown as AutomationDirectory,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  access.actor.mockResolvedValue(account(false));
  access.account.mockResolvedValue(account(false));
  access.permissions.mockResolvedValue(PERMISSIONS);
  access.canSeeScript.mockReturnValue(true);
  directory.agents.mockResolvedValue([]);
  directory.plans.mockResolvedValue([]);
  directory.projects.mockResolvedValue([]);
  directory.memberProjects.mockResolvedValue([]);
  directory.groups.mockResolvedValue([]);
  directory.workspaces.mockResolvedValue([{ id: "w", name: "W" }]);
  directory.interpreterProfiles.mockResolvedValue([{ id: "i", name: "I" }]);
  state.runLatest.mockResolvedValue(new Map());
});

it("offers the options of a plain account", async () => {
  directory.agents.mockResolvedValue([{ id: "g" }]);
  directory.plans.mockResolvedValue([{ id: "p1", canStart: false }]);
  directory.planSteps.mockResolvedValue(null);
  const options = await reads().options("u1");
  expect(options.actions).toEqual([
    { type: "agent", isAllowed: true },
    { type: "script", isAllowed: false },
    { type: "plan", isAllowed: false },
  ]);
  expect(options.workspaces).toEqual([]);
  expect(options.interpreterProfiles).toEqual([]);
  expect(options.plans).toEqual([{ id: "p1", canStart: false, steps: [] }]);
  expect(options.defaultTimeZone).toBe("Europe/Berlin");
  expect(options.timeZones[0]).toBe("Europe/Berlin");
  expect(new Set(options.timeZones).size).toBe(options.timeZones.length);
});

it("offers scripts and workspaces to an administrator", async () => {
  access.actor.mockResolvedValue(account(true));
  directory.plans.mockResolvedValue([{ id: "p1", canStart: true }]);
  directory.planSteps.mockResolvedValue([{ id: "s", name: "S" }]);
  const options = await reads().options("u1");
  expect(options.actions).toEqual([
    { type: "agent", isAllowed: false },
    { type: "script", isAllowed: true },
    { type: "plan", isAllowed: true },
  ]);
  expect(options.workspaces).toEqual([{ id: "w", name: "W" }]);
  expect(options.interpreterProfiles).toEqual([{ id: "i", name: "I" }]);
  expect(options.plans[0]?.steps).toEqual([{ id: "s", name: "S" }]);
});

it("lists steps for the first hundred plans only", async () => {
  const plans = Array.from({ length: 101 }, (_, index) => ({
    id: `p${index}`,
    canStart: false,
  }));
  directory.plans.mockResolvedValue(plans);
  directory.planSteps.mockResolvedValue([]);
  const options = await reads().options("u1");
  expect(directory.planSteps).toHaveBeenCalledTimes(100);
  expect(options.plans).toHaveLength(101);
  expect(options.plans[100]?.steps).toEqual([]);
});

it("lists a page without a next cursor", async () => {
  state.list.mockResolvedValue([automation("a1")]);
  state.runLatest.mockResolvedValue(new Map([["a1", run(1)]]));
  const page = await reads().list("u1", {
    text: "x",
    isActive: true,
    limit: 5,
  });
  expect(page.nextCursor).toBeNull();
  expect(page.items[0]?.lastRun?.runId).toBe("r1");
  expect(state.list).toHaveBeenCalledWith({
    viewerId: "u1",
    isAdministrator: false,
    text: "x",
    isActive: true,
    after: undefined,
    limit: 6,
  });
});

it("lists with a cursor and returns the next cursor", async () => {
  const cursor = encodeAutomationCursor({ createdAt: "c0", id: "a0" });
  state.list.mockResolvedValue([automation("a1"), automation("a2")]);
  const page = await reads().list("u1", { limit: 1, cursor });
  expect(state.list.mock.calls[0]?.[0]).toMatchObject({
    after: { createdAt: "c0", id: "a0" },
    limit: 2,
  });
  expect(page.items).toHaveLength(1);
  expect(page.nextCursor).toBe(
    encodeAutomationCursor({ createdAt: "created-a1", id: "a1" }),
  );
});

it("ignores an incomplete list cursor and uses the default limit", async () => {
  state.list.mockResolvedValue([]);
  const cursor = encodeAutomationCursor({ sequence: 4 });
  const page = await reads().list("u1", { cursor });
  expect(state.list.mock.calls[0]?.[0]).toMatchObject({ after: undefined });
  expect(page).toEqual({ items: [], nextCursor: null });
  const partial = encodeAutomationCursor({ createdAt: "c" });
  await reads().list("u1", { cursor: partial });
  expect(state.list.mock.calls[1]?.[0]).toMatchObject({ after: undefined });
});

it("reads one visible automation", async () => {
  state.find.mockResolvedValue(automation("a1"));
  const view = await reads().read("u1", { automationId: "a1" });
  expect(view.id).toBe("a1");
});

it("hides missing and unreadable automations", async () => {
  state.find.mockResolvedValue(null);
  await expect(reads().read("u1", { automationId: "a1" })).rejects.toThrow();
  state.find.mockResolvedValue(automation("a1"));
  access.permissions.mockResolvedValue({ ...PERMISSIONS, canRead: false });
  await expect(reads().read("u1", { automationId: "a1" })).rejects.toThrow();
});

it("fails when the view of a visible automation is missing", async () => {
  state.find.mockResolvedValue(automation("a1"));
  const subject = reads();
  vi.spyOn(subject, "views").mockResolvedValue([]);
  await expect(subject.read("u1", { automationId: "a1" })).rejects.toThrow();
});

it("pages the runs of an automation", async () => {
  state.find.mockResolvedValue(automation("a1"));
  state.runList.mockResolvedValue([run(3), run(2), run(1)]);
  const page = await reads().runs("u1", { automationId: "a1", limit: 2 });
  expect(page.items.map((item) => item.runId)).toEqual(["r3", "r2"]);
  expect(page.items[0]?.automationName).toBe("Name a1");
  expect(page.nextCursor).toBe(encodeAutomationCursor({ sequence: 2 }));
  expect(state.runList).toHaveBeenCalledWith({
    automationIds: ["a1"],
    beforeSequence: null,
    limit: 3,
  });
});

it("continues the runs after a cursor", async () => {
  state.find.mockResolvedValue(automation("a1"));
  state.runList.mockResolvedValue([run(1)]);
  const cursor = encodeAutomationCursor({ sequence: 2 });
  const page = await reads().runs("u1", { automationId: "a1", cursor });
  expect(state.runList.mock.calls[0]?.[0]).toMatchObject({
    beforeSequence: 2,
  });
  expect(page.nextCursor).toBeNull();
});

it("reads the history of every visible automation", async () => {
  state.list.mockResolvedValue([automation("a1")]);
  state.runList.mockResolvedValue([run(1, "a1"), run(2, "gone")]);
  const page = await reads().history("u1", {});
  expect(state.list).toHaveBeenCalledWith({
    viewerId: "u1",
    isAdministrator: false,
    limit: 1000,
  });
  expect(page.items.map((item) => item.automationName)).toEqual([
    "Name a1",
    "",
  ]);
});

it("reads one run with its deliveries", async () => {
  state.find.mockResolvedValue(automation("a1"));
  state.runFind.mockResolvedValue(run(1));
  state.jobsForRuns.mockResolvedValue([]);
  access.canSeeScript.mockReturnValue(false);
  const detail = await reads().run("u1", { automationId: "a1", runId: "r1" });
  expect(state.jobsForRuns).toHaveBeenCalledWith(["r1"]);
  expect(detail.output).toBeNull();
  expect(detail.deliveries).toEqual([]);
});

it("hides a missing run", async () => {
  state.find.mockResolvedValue(automation("a1"));
  state.runFind.mockResolvedValue(null);
  await expect(
    reads().run("u1", { automationId: "a1", runId: "r1" }),
  ).rejects.toThrow();
});

it("builds views and reads each creator once", async () => {
  access.account.mockResolvedValue(null);
  const views = await reads().views(
    [automation("a1"), automation("a2"), automation("a3", "u2")],
    account(false),
  );
  expect(access.account).toHaveBeenCalledTimes(2);
  expect(views).toHaveLength(3);
  expect(views[0]?.creator.displayName).toBe("");
  expect(views[0]?.lastRun).toBeNull();
});
