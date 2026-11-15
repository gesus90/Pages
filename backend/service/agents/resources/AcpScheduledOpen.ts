import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { logCaughtError } from "@/backend/logging/Logger";
import { confirmFailedStart } from "./AcpLeaseProcesses";

import type {
  PlanSession,
  PlanSessionObserver,
} from "@/backend/agents/AgentPlanExecution";
import type {
  AcpResourceOwner,
  AcpResourceRecord,
  AcpResourceState,
} from "@/definition/AcpResource";
import type { AcpOpenRequest } from "./AcpAdmissionRequest";
import type { AcpLeaseChecks } from "./AcpLeaseChecks";

interface ScheduledOpenHost {
  readonly shutdown: AbortSignal;
  readonly checks: AcpLeaseChecks;
  readonly active: Map<string, AcpResourceRecord>;
  readonly sessions: Map<string, PlanSession>;
  isClosing(): boolean;
  acquire(
    owner: AcpResourceOwner,
    signal: AbortSignal,
    deadline?: number,
  ): Promise<void>;
  transition(id: string, state: AcpResourceState): Promise<void>;
  wrap(
    id: string,
    native: PlanSession,
    observer: PlanSessionObserver | undefined,
  ): PlanSession;
  cleanup(
    record: AcpResourceRecord,
    since: string | null,
  ): Promise<{ readonly remaining: number }>;
  finish(id: string, confirmed: boolean): Promise<boolean>;
}

/** Opens a reserved session and retains capacity until failed startup is settled. */
export async function openScheduledSession(
  request: AcpOpenRequest,
  host: ScheduledOpenHost,
): Promise<PlanSession> {
  const { owner, start, observer } = request;
  const combined = AbortSignal.any([request.signal, host.shutdown]);
  await host.acquire(owner, combined, request.deadlineMs);
  let native: PlanSession | null = null;
  let hasAttemptedStart = false;
  try {
    if (combined.aborted || host.isClosing())
      throw new AgentPlanCancelledError();
    hasAttemptedStart = true;
    native = await start(combined, host.checks.lifecycle(owner.instanceId));
    await host.transition(owner.instanceId, "running");
    const session = host.wrap(owner.instanceId, native, observer);
    host.sessions.set(owner.instanceId, session);
    return session;
  } catch (error: unknown) {
    logCaughtError("AcpResourceScheduler", error);
    const current = host.active.get(owner.instanceId);
    const isConfirmed = await confirmFailedStart({
      error,
      native,
      isProven:
        !hasAttemptedStart ||
        host.checks.isStartEnded(owner.instanceId, native),
      close: () =>
        host.cleanup(
          current ?? { ...owner, state: "starting", since: "" },
          current?.since ?? null,
        ),
    });
    await host.finish(owner.instanceId, isConfirmed);
    throw error;
  }
}
