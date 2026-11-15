import { beforeEach, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { AutomationAgentWorker } from "@/backend/service/automation/AutomationAgentWorker";
import { AgentAutomationTurns } from "@/backend/service/employee/AgentAutomationTurns";

import type { StoredAutomationAgentJob } from "@/backend/database/repositories/automation/AutomationAgentJobRepository";
import type { AutomationAgentRunner } from "@/backend/service/automation/AutomationAgentWorker";
import type { AgentAutomationTurnDependencies } from "@/backend/service/employee/AgentAutomationTurns";
import type { User } from "@/definition/User";
import { partialStub } from "../../stub-fixture";

const repositories = vi.hoisted(() => ({
  heads: vi.fn(),
  deliver: vi.fn(),
  finish: vi.fn(),
  find: vi.fn(),
  runDeliver: vi.fn(),
}));

vi.mock(
  "@/backend/database/repositories/automation/AutomationAgentJobRepository",
  () => ({
    AutomationAgentJobRepository: class {
      public heads = repositories.heads;
      public deliver = repositories.deliver;
      public finish = repositories.finish;
    },
  }),
);
vi.mock(
  "@/backend/database/repositories/automation/AutomationRepository",
  () => ({
    AutomationRepository: class {
      public find = repositories.find;
    },
  }),
);
vi.mock(
  "@/backend/database/repositories/automation/AutomationRunRepository",
  () => ({
    AutomationRunRepository: class {
      public deliver = repositories.runDeliver;
    },
  }),
);

type RunnerStart = AutomationAgentRunner["start"];

const PROMPT =
  "[Geplante Erinnerung aus diesem Chat, angelegt von Igor]\nUrsprüngliche Bitte: „Erinnere mich morgen um 9 an den Zahnarzt“";

function job(
  fields: Partial<StoredAutomationAgentJob> = {},
): StoredAutomationAgentJob {
  return {
    id: "job-1",
    runId: "run-1",
    automationId: "automation-1",
    agentId: "agent",
    creatorId: "igor",
    kind: "action",
    prompt: PROMPT,
    state: "queued",
    answer: null,
    errorCode: null,
    sessionId: null,
    queuedAt: "2026-11-16T08:00:00.000Z",
    deliveredAt: null,
    completedAt: null,
    ...fields,
  };
}

function worker(
  start: Mock<RunnerStart>,
  binding: unknown,
): AutomationAgentWorker {
  return new AutomationAgentWorker({
    database: partialStub<never>({}),
    rules: partialStub<never>({
      account: vi.fn(async () => ({ accountId: "igor" })),
      canUseAgent: vi.fn(async () => true),
    }),
    runner: { start },
    now: () => new Date("2026-11-16T08:00:00.000Z"),
    chatTasks: { find: vi.fn(async () => binding) as never },
  });
}

function starter(): Mock<RunnerStart> {
  return vi.fn<RunnerStart>(async () => ({
    sessionId: "s",
    answer: Promise.resolve("Erinnerung: Zahnarzt um 9"),
  }));
}

beforeEach(() => {
  vi.resetAllMocks();
  repositories.deliver.mockResolvedValue(true);
  repositories.find.mockResolvedValue({
    action: { type: "agent", agentId: "agent", instruction: PROMPT },
  });
});

it("delivers a task of a group into the bound conversation, never by its name", async () => {
  repositories.heads.mockResolvedValue([job()]);
  const start = starter();
  await worker(start, {
    automationId: "automation-1",
    chat: { kind: "group", conversationId: "group-1" },
  }).pass();
  await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
  expect(start.mock.calls[0]?.[0]).toMatchObject({
    chat: null,
    conversationId: "group-1",
    prompt: PROMPT,
    creatorId: "igor",
    runKey: "run-1",
  });
});

it("delivers a task of a direct chat into the direct chat of the person who asked", async () => {
  repositories.heads.mockResolvedValue([job()]);
  const start = starter();
  await worker(start, {
    automationId: "automation-1",
    chat: { kind: "direct", personId: "igor" },
  }).pass();
  await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
  const request = start.mock.calls[0]?.[0];
  expect(request).toMatchObject({ chat: null, creatorId: "igor" });
  expect(request).not.toHaveProperty("conversationId");
  await vi.waitFor(() =>
    expect(repositories.finish).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({
        state: "completed",
        answer: "Erinnerung: Zahnarzt um 9",
      }),
    ),
  );
});

const igor: User = {
  id: "igor",
  username: "igor",
  displayName: "Igor",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};
const agent: User = {
  ...igor,
  id: "agent",
  username: "all-might",
  displayName: "All Might",
  isAgent: true,
};

type PostResultFn = (
  agentId: string,
  message: { conversationId: string; key: string; text: string },
) => Promise<void>;

function turns(sharedGroup: string | null): {
  readonly turns: AgentAutomationTurns;
  readonly run: ReturnType<typeof vi.fn>;
  readonly postResult: ReturnType<typeof vi.fn<PostResultFn>>;
  readonly findSharedGroup: ReturnType<typeof vi.fn>;
} {
  const findSharedGroup = vi.fn(async () => sharedGroup);
  const run = vi.fn(async () => ({
    sessionId: "group-session",
    start: { job: { id: "job" } },
  }));
  const postResult = vi.fn<PostResultFn>(async () => undefined);
  let answer = 0;
  const dependencies = {
    store: partialStub({
      conversations: () => ({ findSharedGroup }),
      employees: () => ({ find: vi.fn(async () => ({ revision: 1 })) }),
    }),
    users: {
      findById: vi.fn(async (id: string) => (id === "agent" ? agent : igor)),
    },
    sessions: { run, job: vi.fn(async () => ({ state: "completed" })) },
    messages: {
      messages: vi.fn(async () => {
        answer += 1;
        return [
          {
            id: `answer-${String(answer)}`,
            role: "assistant",
            content: `3 offene Tickets (Lauf ${String(answer)})`,
          },
        ];
      }),
    },
    chatPoster: { postResult },
    simulation: null,
    now: () => new Date("2026-11-16T08:00:00.000Z"),
  };
  return {
    turns: new AgentAutomationTurns(
      dependencies as unknown as AgentAutomationTurnDependencies,
    ),
    run,
    postResult,
    findSharedGroup,
  };
}

it("runs every run of a recurring task in the group's session and posts each result there", async () => {
  const fixture = turns("Pages Team");
  for (const runKey of ["run-1", "run-2"]) {
    const turn = await fixture.turns.start({
      agentId: "agent",
      creatorId: "igor",
      sessionKey: "automation:automation-1",
      prompt: "[Geplante Aufgabe aus diesem Chat, angelegt von Igor]",
      runKey,
      conversationId: "group-1",
    });
    await turn.answer;
  }
  expect(fixture.findSharedGroup).toHaveBeenCalledWith("group-1", [
    "agent",
    "igor",
  ]);
  expect(fixture.run).toHaveBeenCalledWith(
    expect.objectContaining({
      purpose: "conversation",
      conversationId: "group-1",
      person: igor,
    }),
  );
  expect(fixture.postResult).toHaveBeenCalledTimes(2);
  expect(fixture.postResult.mock.calls[0]?.[0]).toBe("agent");
  expect(fixture.postResult.mock.calls[0]?.[1]).toMatchObject({
    conversationId: "group-1",
    key: "run-1",
  });
  expect(fixture.postResult.mock.calls[0]?.[1].text).toContain(
    "3 offene Tickets",
  );
  expect(fixture.postResult.mock.calls[1]?.[0]).toBe("agent");
  expect(fixture.postResult.mock.calls[1]?.[1]).toMatchObject({
    conversationId: "group-1",
    key: "run-2",
  });
  expect(fixture.postResult.mock.calls[1]?.[1].text).toContain(
    "3 offene Tickets",
  );
});

it("fails the run of a task whose group is gone or left by its agent or person", async () => {
  const fixture = turns(null);
  await expect(
    fixture.turns.start({
      agentId: "agent",
      creatorId: "igor",
      sessionKey: "automation:automation-1",
      prompt: "x",
      conversationId: "group-1",
    }),
  ).rejects.toMatchObject({ code: "target_chat_not_found" });
  expect(fixture.run).not.toHaveBeenCalled();
});
