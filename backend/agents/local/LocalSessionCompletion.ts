import { AgentError } from "@/backend/error/AgentErrors";
import { requireAgentFiles } from "@/backend/storage/AgentPayloadFileStore";

import { localMutationSchema } from "./LocalSessionContracts";

import type { PlanSession } from "@/backend/agents/AgentPlanExecution";
import type { Database } from "@/backend/database/Database";
import type { LocalSessionRepository } from "@/backend/database/repositories/agent/LocalSessionRepository";
import type { LocalSessionMutation } from "./LocalSessionContracts";

/** Reads the stored result of a native session turn, if it has one. */
export async function readLocalCompletion(
  owners: Pick<LocalSessionRepository, "result">,
  database: Database,
  instanceId: string,
  turnId: string,
): Promise<LocalSessionMutation | null> {
  const reference = await owners.result(instanceId, turnId);
  return reference
    ? localMutationSchema.parse(
        JSON.parse(await requireAgentFiles(database).read(reference)),
      )
    : null;
}

/** Reads the committed milestones used to restore retained native group bookkeeping. */
export async function readLocalMilestones(
  owners: Pick<LocalSessionRepository, "list">,
  database: Database,
  instanceKey: string,
  instanceId: string,
): Promise<readonly LocalSessionMutation[]> {
  const entry = (await owners.list(instanceKey)).find(
    (candidate) => candidate.instanceId === instanceId,
  );
  if (!entry?.checkpointFile) return [];
  const checkpoint: unknown = JSON.parse(
    await requireAgentFiles(database).read(entry.checkpointFile),
  );
  if (!Array.isArray(checkpoint))
    throw new Error("Invalid local session checkpoint");
  return checkpoint.map((mutation: unknown) =>
    localMutationSchema.parse(mutation),
  );
}

/** Wraps a reattached session with a stored turn completion when already recorded. */
export function createReattachedLocalSession(
  session: PlanSession,
  result: LocalSessionMutation | null,
): PlanSession {
  return {
    turn:
      result?.kind === "turn" ? Promise.resolve(result.result) : session.turn,
    isDurable: true,
    terminated: session.terminated,
    get isDetached(): boolean {
      return session.isDetached === true;
    },
    get isClosing(): boolean {
      return session.isClosing === true;
    },
    detach: () => session.detach?.(),
    close: () => session.close(),
    next: (input, nextSignal, nextObserver) => {
      if (!session.next) throw new AgentError("plan_group_session_unsupported");
      return session.next(input, nextSignal, nextObserver);
    },
    steer: (prompt) => session.steer?.(prompt) ?? Promise.resolve("inactive"),
    interrupt: () => session.interrupt?.() ?? Promise.resolve(false),
  };
}
