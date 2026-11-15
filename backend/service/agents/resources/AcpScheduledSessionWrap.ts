import { ScheduledAcpSession } from "./ScheduledAcpSession";
import { settleAcpSessionLease } from "./AcpLeaseOwnership";

import type {
  PlanSession,
  PlanSessionObserver,
} from "@/backend/agents/AgentPlanExecution";
import type {
  AcpResourceRecord,
  AcpResourceState,
} from "@/definition/AcpResource";

/** The lease bookkeeping a wrapped session needs from its scheduler. */
export interface AcpSessionWrapContext {
  readonly active: ReadonlyMap<string, AcpResourceRecord>;
  transition(
    instanceId: string,
    state: AcpResourceState,
    stepId?: string,
  ): Promise<void>;
  finish(instanceId: string, isConfirmed: boolean): Promise<boolean>;
  cleanupLease(
    record: AcpResourceRecord,
  ): Promise<{ readonly remaining: number }>;
}

/** Wraps a started native session so its lease follows the scheduler's bookkeeping. */
export function wrapAcpSession(
  instanceId: string,
  session: PlanSession,
  observer: PlanSessionObserver | undefined,
  context: AcpSessionWrapContext,
): ScheduledAcpSession {
  return new ScheduledAcpSession(
    session,
    {
      transition: (state, stepId) =>
        context.transition(instanceId, state, stepId),
      finish: (isConfirmed) => context.finish(instanceId, isConfirmed),
      settle: (error) =>
        settleAcpSessionLease(context.active.get(instanceId), error, (record) =>
          context.cleanupLease(record),
        ),
    },
    observer,
  );
}
