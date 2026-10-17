import { expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { offerGroupInstructions } from "@/backend/service/agents/AgentPlanGroupInstructions";
import { AgentPlanGroupSessions } from "@/backend/service/agents/AgentPlanGroupSessions";
import { AgentSessionInbox } from "@/backend/service/agents/sessions/AgentSessionInbox";
import { AgentSessionJournal } from "@/backend/service/agents/sessions/AgentSessionJournal";
import { AgentSessionService } from "@/backend/service/agents/sessions/AgentSessionService";

import {
  MemorySessionStore,
  sessionRecord,
  sessionRun,
  sessionStep,
} from "./page85-session-fixture";

import type {
  AgentPlanSessionInput,
  PlanExecution,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";

const REPAIR = "Behebe den TypeScript-Buildfehler und prüfe erneut";
const PLAN_PROMPT = "Frozen plan assignment";

function finished(output: string): PlanSessionTurn {
  return {
    output,
    sessionId: "acp-1",
    failure: null,
    errorCode: null,
    endedAt: "t",
    permissionDenials: 0,
    effective: {},
    events: [],
  };
}

function groupInput(): AgentPlanSessionInput {
  const input: unknown = {
    prompt: PLAN_PROMPT,
    userId: "executor",
    directory: "/workspace",
    instanceId: "process",
    mcp: null,
    options: { timeoutMinutes: 10 },
    agent: {
      model: "claude-opus-5-5",
      reasoningEffort: "high",
      connection: { id: "connection", provider: "claude_code" },
    },
    resourceContext: { runId: "run-1", stepId: "member-a" },
  };
  // Only the fields the group session reads are present in this boundary stub.
  return input as AgentPlanSessionInput;
}

it("runs an instruction as a separate queued turn of the open group session without touching the plan prompt", async () => {
  const prompts: string[] = [];
  const execution: PlanExecution = {
    run: async () => "",
    open: async (input) => {
      prompts.push(input.prompt);
      return {
        turn: Promise.resolve(finished("first")),
        next: async (next) => {
          prompts.push(next.prompt);
          return finished(next.prompt);
        },
        close: async () => ({
          exit: { code: 0, signal: null },
          endedAt: "t",
          leftovers: 0,
          isConfirmed: true,
        }),
      };
    },
  };
  const groups = new AgentPlanGroupSessions(execution);
  const input = groupInput();
  const controller = new AbortController();
  const memberSlot = groups.reserve("run-1/group");
  await memberSlot.ready;
  const opened = await groups.turn({
    key: "run-1/group",
    input,
    signal: controller.signal,
    observer: { started: () => undefined, identified: () => undefined },
  });
  await opened.turn;

  const run = sessionRun([
    sessionStep(
      "member-a",
      sessionRecord({ attemptId: "attempt-a", instanceId: "process" }),
      { groupId: "group", status: "succeeded" },
    ),
  ]);
  const store = new MemorySessionStore();
  const journal = new AgentSessionJournal(store);
  const service = new AgentSessionService({
    runs: { run: async () => run, stop: async () => run },
    store,
    journal,
    inbox: new AgentSessionInbox(store, journal),
  });
  const node = {
    run,
    step: { step: { id: "member-a" }, groupId: "group" },
    record: run.steps[0]?.session ?? null,
    control: { signal: controller.signal },
  };
  service.listen(node, "process");
  offerGroupInstructions({
    sessions: service,
    groups,
    node,
    key: "run-1/group",
    input,
  });
  const key = {
    planId: "plan-1",
    runId: "run-1",
    stepId: "member-a",
    attemptId: "attempt-a",
  };
  const sent = await service.send("executor", key, {
    kind: "repair",
    text: REPAIR,
  });
  expect(sent.delivery).toBe("queued");
  // The member's own turn still holds the group's queue; the instruction waits for it.
  await service.settle(node.record, { failure: null, errorCode: null });
  await Promise.resolve();
  expect(prompts).toEqual([PLAN_PROMPT]);
  memberSlot.release();
  await vi.waitFor(() => expect(prompts).toEqual([PLAN_PROMPT, REPAIR]));
  expect(input.prompt).toBe(PLAN_PROMPT);
  await vi.waitFor(async () =>
    expect((await service.view("executor", key)).messages[0]?.status).toBe(
      "delivered",
    ),
  );
  expect(
    groups.link("run-1/group", {
      groupId: "group",
      stepId: "member-b",
      adapter: "claude_code",
    }).turn,
  ).toBe(3);
});

it("refuses an instruction when the group session is closed", async () => {
  const groups = new AgentPlanGroupSessions({
    run: async () => "",
    open: async () => {
      throw new Error("not opened");
    },
  });
  const failure = await groups
    .instruct({
      key: "run-1/group",
      input: groupInput(),
      signal: new AbortController().signal,
      observer: { started: () => undefined, identified: () => undefined },
    })
    .then(
      () => "none",
      (error: unknown) =>
        error instanceof AgentError ? error.code : "unexpected",
    );
  expect(failure).toBe("plan_session_unavailable");
});
