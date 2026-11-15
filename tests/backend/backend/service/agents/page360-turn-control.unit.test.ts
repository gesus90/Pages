import { expect, it, vi } from "vitest";

import { AgentPlanStepRunner } from "@/backend/service/agents/AgentPlanStepRunner";
import { planPauseGate } from "@/backend/service/agents/AgentPlanPauseGate";

import { parameterRunFixture } from "./page55-run-fixture";
import { reportedTurn } from "./page333-closeout-fixture";
import {
  progressSession,
  progressStep,
  progressTicket,
} from "./page162-progress-fixture";

import type { PlanSessionTurn } from "@/backend/agents/AgentPlanExecution";

const OPEN_REPORT =
  '```pages-report\n{"todos":[{"id":"T1","status":"open"}],"decisions":[],"summary":"Work"}\n```';
const DONE_REPORT =
  '```pages-report\n{"todos":[{"id":"T1","status":"done"}],"decisions":[],"summary":"Work"}\n```';

/** One native-session step whose first turn answers with `output`; returns carry the done report. */
async function stepWithFirstAnswer(output: string): Promise<{
  readonly runId: string;
  readonly result: () => ReturnType<AgentPlanStepRunner["run"]>;
  readonly next: ReturnType<typeof vi.fn<() => Promise<PlanSessionTurn>>>;
}> {
  const fixture = await parameterRunFixture(undefined, "codex_cli");
  const step = {
    ...fixture.step,
    step: {
      ...fixture.step.step,
      instruction: "- [ ] Implement feature",
      completion: "todos" as const,
    },
  };
  const snapshot = {
    ...fixture.snapshot,
    steps: [step],
    plan: { ...fixture.snapshot.plan, nodes: [step.step] },
  };
  const next = vi.fn(async () => reportedTurn({ output: DONE_REPORT }));
  const runner = new AgentPlanStepRunner({
    start: fixture.start,
    tasks: { checklist: async () => progressTicket() },
    access: { grant: async () => null, revoke: async () => 1 },
    execution: {
      run: async () => "",
      open: async () => ({
        turn: Promise.resolve(reportedTurn({ output })),
        next,
        close: async () => ({
          exit: { code: 0, signal: null },
          endedAt: "now",
          leftovers: 0,
          isConfirmed: true,
          containment: "pid_namespace" as const,
        }),
      }),
    },
  });
  const run = {
    ...fixture.run,
    steps: [
      progressStep({
        id: step.step.id,
        status: "paused",
        session: progressSession([]),
      }),
    ],
  };
  return {
    runId: run.id,
    next,
    result: () =>
      runner.run(run, snapshot, step, {
        signal: new AbortController().signal,
        save: async () => undefined,
      }),
  };
}

it("holds the judgement of a finished turn while the run is paused and judges it after the resume", async () => {
  const scenario = await stepWithFirstAnswer(OPEN_REPORT);
  const gate = planPauseGate(scenario.runId);
  gate.pause();
  let isSettled = false;
  const pending = scenario.result().then((result) => {
    isSettled = true;
    return result;
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(isSettled).toBe(false);
  expect(scenario.next).not.toHaveBeenCalled();

  gate.resume();
  const result = await pending;

  expect(result.status).toBe("succeeded");
  expect(scenario.next).toHaveBeenCalledTimes(1);
});

it("leaves an answer without any report to the step retry instead of returning TODOs", async () => {
  const scenario = await stepWithFirstAnswer("I am finished");

  const result = await scenario.result();

  expect(scenario.next).not.toHaveBeenCalled();
  expect(result.status).toBe("failed");
});
