import { expect, it } from "vitest";

import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import { applyRunnerMessage } from "@/backend/service/runner/RunnerProtocol";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type {
  RunnerJob,
  RunnerMessage,
  RunnerState,
} from "@/definition/RunnerProtocol";

const JOB = partial<RunnerJob>({
  jobId: "job",
  sessionId: "session",
  status: "queued",
});
const STATE = partial<RunnerState>({
  sessionId: "session",
  sequence: 0,
  jobs: [JOB],
});
const EVENT = partial<Extract<RunnerMessage, { type: "event" }>>({
  type: "event",
  sessionId: "session",
  eventId: "event",
  sequence: 1,
  job: { ...JOB, status: "accepted" },
});

it("accepts a sequenced job transition and acknowledges identical replay", () => {
  const applied = applyRunnerMessage(STATE, EVENT);
  expect(applied.state.jobs[0]?.status).toBe("accepted");
  expect(applied.reply).toMatchObject({
    type: "ack",
    eventId: "event",
    sequence: 1,
  });
  expect(applyRunnerMessage(applied.state, EVENT).reply).toMatchObject({
    type: "ack",
  });
  expect(() =>
    applyRunnerMessage({ ...applied.state, lastEventDigest: "other" }, EVENT),
  ).toThrow("requires reconciliation");
  expect(applied.state.lastEventDigest).toBe(planContentDigest(EVENT));
});

it("rejects mismatched sessions, gaps, illegal transitions and changed commands", () => {
  expect(() =>
    applyRunnerMessage(STATE, { ...EVENT, sessionId: "other" }),
  ).toThrow("session mismatch");
  expect(() => applyRunnerMessage(STATE, { ...EVENT, sequence: 2 })).toThrow(
    "out of sequence",
  );
  expect(() =>
    applyRunnerMessage(STATE, {
      ...EVENT,
      job: { ...EVENT.job, status: "completed" },
    }),
  ).toThrow("Invalid runner job transition");
  expect(() =>
    applyRunnerMessage(
      STATE,
      partial<RunnerMessage>({
        ...EVENT,
        job: { ...EVENT.job, execution: { version: 1 } },
      }),
    ),
  ).toThrow("Runner command changed");
});

it("acknowledges late facts by reconciling to the terminal job", () => {
  const state = { ...STATE, jobs: [{ ...JOB, status: "completed" as const }] };
  const result = applyRunnerMessage(state, EVENT);
  expect(result.state.jobs[0]?.status).toBe("completed");
  expect(result.reply.type).toBe("reconcile");
});
