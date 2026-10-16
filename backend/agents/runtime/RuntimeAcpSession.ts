import { randomUUID } from "node:crypto";

import { AcpCleanupUnconfirmedError } from "@/backend/error/AcpCleanupUnconfirmedError";

import type { PlanSession } from "@/backend/agents/AgentPlanExecution";
import type { AcpResourceScheduler } from "@/backend/service/agents/AcpResourceScheduler";
import type { AcpResourceOwner } from "@/definition/AcpResource";
import type { RuntimeExecutionContext } from "./RuntimeExecutionContext";

/** The admitted native starter must enforce connection access and process isolation. */
export interface RuntimeAcpStart {
  readonly context: RuntimeExecutionContext;
  readonly instanceId: string;
  readonly prompt: string;
  readonly signal: AbortSignal;
}

/** Uses the shared recovered scheduler, never a second queue or an already scheduled starter. */
export interface RuntimeAcpOptions {
  readonly context: RuntimeExecutionContext;
  readonly scheduler: AcpResourceScheduler;
  readonly provider: AcpResourceOwner["provider"];
  readonly start: (request: RuntimeAcpStart) => Promise<PlanSession>;
}

/** Runs one native turn and retains its lease until the scheduler confirms closeout. */
export async function runRuntimeAcpTurn(
  options: RuntimeAcpOptions,
  prompt: string,
  signal: AbortSignal = options.context.signal,
): Promise<string> {
  const { context, scheduler } = options;
  const combined = AbortSignal.any([context.signal, signal]);
  combined.throwIfAborted();
  await context.authorize();
  const instanceId = randomUUID();
  const session = await scheduler.open(
    {
      instanceId,
      userId: context.userId,
      runId: context.runId,
      stepId: null,
      provider: options.provider,
    },
    combined,
    async (admitted) => {
      await context.authorize();
      admitted.throwIfAborted();
      return options.start({ context, instanceId, prompt, signal: admitted });
    },
  );
  try {
    const turn = await session.turn;
    combined.throwIfAborted();
    if (turn.failure !== null || turn.errorCode !== null)
      throw new Error("Native ACP runtime turn failed");
    return turn.output;
  } finally {
    const closed = await session.close();
    if (!closed.isConfirmed) throw new AcpCleanupUnconfirmedError();
  }
}
