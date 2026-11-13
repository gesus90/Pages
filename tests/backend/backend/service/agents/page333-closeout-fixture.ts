import { vi } from "vitest";

import { AgentPlanStepRunner } from "@/backend/service/agents/AgentPlanStepRunner";

import { parameterRunFixture } from "./page55-run-fixture";

import type {
  PlanSession,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";

/** A successful business report, independent of the process closeout. */
export function reportedTurn(
  overrides: Partial<PlanSessionTurn> = {},
): PlanSessionTurn {
  return {
    output:
      "```pages-report\n" +
      JSON.stringify({
        todos: [{ id: "T1", status: "done" }],
        criteria: [
          {
            id: "K1",
            met: true,
            evidence:
              "Synthetic closeout regression asserts the actual step verdict.",
          },
        ],
        decisions: [],
        summary: "Closeout verified.",
      }) +
      "\n```",
    sessionId: "native-session",
    failure: null,
    errorCode: null,
    endedAt: "2026-11-12T10:00:00.000Z",
    permissionDenials: 0,
    effective: {},
    events: [],
    ...overrides,
  };
}

/** Runs the public node boundary with a synthetic native session and no external IO. */
export async function runClosedStep(
  session: PlanSession,
  hasNamespace = true,
): Promise<{
  readonly result: Awaited<ReturnType<AgentPlanStepRunner["run"]>>;
  readonly records: AgentPlanSessionRecord[];
  readonly revoke: ReturnType<typeof vi.fn>;
}> {
  const fixture = await parameterRunFixture(undefined, "codex_cli");
  const records: AgentPlanSessionRecord[] = [];
  const revoke = vi.fn(async () => 1);
  const runner = new AgentPlanStepRunner({
    start: fixture.start,
    execution: {
      run: async () => {
        throw new Error("Unexpected API execution");
      },
      open: async (input, signal, observer) => {
        observer.started({
          mode: "interactive",
          processId: 42,
          startedAt: "2026-11-12T09:00:00.000Z",
          arguments: [],
          unattended: "synthetic",
          ...(hasNamespace
            ? {
                namespace: {
                  pid: 42,
                  uid: 1000,
                  start: 1234,
                  boot: "11111111-1111-4111-8111-111111111111",
                },
              }
            : {}),
        });
        return session;
      },
    },
    tasks: {
      checklist: async () => {
        throw new Error("No tickets in this fixture");
      },
    },
    access: { grant: async () => null, revoke },
  });
  const result = await runner.run(fixture.run, fixture.snapshot, fixture.step, {
    signal: new AbortController().signal,
    save: async (record) => {
      records.push(record);
    },
  });
  return { result, records, revoke };
}
