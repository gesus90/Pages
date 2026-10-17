import { expect, it, vi } from "vitest";

import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";
import { AgentSessionInbox } from "@/backend/service/agents/sessions/AgentSessionInbox";
import { AgentSessionJournal } from "@/backend/service/agents/sessions/AgentSessionJournal";
import { AgentSessionService } from "@/backend/service/agents/sessions/AgentSessionService";

import {
  MemorySessionStore,
  sessionRecord,
  sessionRun,
  sessionStep,
} from "./page85-session-fixture";

it.each(["codex_cli", "claude_code", "opencode"] as const)(
  "keeps persisted %s capabilities across a Pages restart while reporting its checkpoint independently",
  async (runner) => {
    const record = sessionRecord({
      runner,
      closeout: "confirmed",
      endedAt: "2026-10-17T02:00:00.000Z",
      continuationCapabilities: {
        adapter: "verified synthetic 1",
        canLoad: true,
        canResume: true,
      },
    });
    const run = readPlanRun(
      JSON.parse(
        JSON.stringify(
          sessionRun(
            [
              sessionStep("node", record, {
                status: "failed",
                error: "plan_interrupted",
              }),
            ],
            {
              status: "failed",
              recovery: { state: "interrupted", requiresReconciliation: true },
            },
          ),
        ),
      ),
    );
    const store = new MemorySessionStore();
    const journal = new AgentSessionJournal(store);
    const hasPlanCheckpoint = vi.fn(async () => true);
    const service = new AgentSessionService({
      runs: { run: async () => run, stop: async () => run },
      store,
      journal,
      inbox: new AgentSessionInbox(store, journal),
      hasPlanCheckpoint,
    });

    const view = await service.view("executor", {
      planId: run.planId,
      runId: run.id,
      stepId: "node",
      attemptId: "attempt-1",
    });

    expect(view.continuation).toEqual({
      mode: "unavailable",
      reason: "pages_resume_unavailable",
      hasPlanCheckpoint: true,
    });
    expect(view.actions.canRecover).toBe(false);
    expect(hasPlanCheckpoint).toHaveBeenCalledExactlyOnceWith(run.id);
    expect(run.steps[0].session?.sessionId).toBe("acp-session-1");
  },
);

it("retains compatibility with records that have no capability evidence or dispatched prompt digest", async () => {
  const record = sessionRecord();
  const run = readPlanRun(
    JSON.parse(JSON.stringify(sessionRun([sessionStep("node", record)]))),
  );

  expect(run.steps[0].session?.continuationCapabilities).toBeUndefined();
  expect(run.steps[0].session?.dispatchedPromptDigest).toBeUndefined();
});
