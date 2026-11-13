import { expect, it, vi } from "vitest";

import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { awaitAgentJobAnswer } from "@/backend/service/employee/AgentJobAnswer";

import { OWNER } from "../chat/page48-chat-fixture";

import type { AgentJobWaiting } from "@/backend/service/employee/AgentJobAnswer";
import type { ChatJob } from "@/definition/ChatJob";

const job = { agent: OWNER, sessionId: "group-agent", jobId: "job" };
const completed: ChatJob = {
  id: "job",
  sessionId: job.sessionId,
  state: "completed",
  errorCode: null,
  createdAt: "today",
  endedAt: "today",
  usage: { context: null, tokens: null, cost: null },
};

function waiting(current: ChatJob | null): AgentJobWaiting {
  return {
    sessions: { job: vi.fn(async () => current) },
    messages: {
      messages: vi.fn<AgentJobWaiting["messages"]["messages"]>(async () => [
        {
          id: "answer",
          role: "assistant",
          content: "Complete answer",
          createdAt: "today",
        },
      ]),
    },
    pollMilliseconds: 1,
    timeoutMilliseconds: 1000,
    now: () => new Date("2026-11-13T10:00:00Z"),
    wait: vi.fn(),
  };
}

it.each([
  ["stopped", null],
  ["interrupted", "interrupted"],
  ["failed", "cli_not_logged_in"],
  ["failed", "plan_step_failed"],
] as const)(
  "PAGE-344 preserves the job's %s/%s outcome instead of unavailable",
  async (state, code) => {
    const dependencies = waiting({ ...completed, state, errorCode: code });
    await expect(awaitAgentJobAnswer(job, dependencies)).rejects.toMatchObject({
      state,
      failureCode: code ?? state,
    });
    expect(dependencies.messages.messages).not.toHaveBeenCalled();
  },
);

it("PAGE-344 returns a completed answer and preserves a wait timeout", async () => {
  await expect(awaitAgentJobAnswer(job, waiting(completed))).resolves.toBe(
    "Complete answer",
  );
  const dependencies = waiting(null);
  if (!dependencies.wait) throw new Error("Missing wait");
  vi.mocked(dependencies.wait).mockImplementation(async () => {
    vi.spyOn(dependencies, "now").mockReturnValue(
      new Date("2026-11-13T10:00:02Z"),
    );
  });
  await expect(awaitAgentJobAnswer(job, dependencies)).rejects.toMatchObject({
    failureCode: "timeout",
  });
});

it("PAGE-344 retains the existing employee error contract for other consumers while exposing the real failure", async () => {
  const operation = awaitAgentJobAnswer(
    job,
    waiting({ ...completed, state: "failed", errorCode: "cli_not_logged_in" }),
  );
  await expect(operation).rejects.toBeInstanceOf(AgentEmployeeError);
  await expect(operation).rejects.toMatchObject({
    code: "unavailable",
    failureCode: "cli_not_logged_in",
    state: "failed",
  });
});
