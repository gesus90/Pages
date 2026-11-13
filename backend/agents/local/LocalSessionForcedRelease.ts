import { logCaughtError } from "@/backend/logging/Logger";

import type { LocalSessionEntry } from "@/backend/database/repositories/agent/LocalSessionRepository";
import type { PlanSession } from "@/backend/agents/AgentPlanExecution";

interface ForcedReleaseContext {
  readonly entries: Map<string, LocalSessionEntry>;
  readonly attached: Pick<
    Map<string, { readonly session: Pick<PlanSession, "detach"> }>,
    "get" | "delete"
  >;
  readonly proven: Set<string>;
  readonly uncertain: Set<string>;
  readonly release: (entry: LocalSessionEntry) => Promise<void>;
}

/** Retires only an explicitly superseded run's observers; process uncertainty remains in the run journal. */
export async function forgetForcedLocalRun(
  runId: string,
  context: ForcedReleaseContext,
): Promise<void> {
  for (const entry of context.entries.values()) {
    if (entry.runId !== runId || entry.releasedAt) continue;
    try {
      await context.release(entry);
    } catch (error: unknown) {
      logCaughtError("LocalSessionForcedRelease", error);
      context.attached.get(entry.instanceId)?.session.detach?.();
      context.entries.set(entry.instanceId, {
        ...entry,
        releasedAt: new Date().toISOString(),
      });
      context.attached.delete(entry.instanceId);
      context.proven.delete(entry.instanceId);
    }
    context.uncertain.delete(entry.instanceId);
  }
}
