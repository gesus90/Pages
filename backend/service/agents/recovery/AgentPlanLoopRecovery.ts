import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type {
  AgentPlanLoopIteration,
  AgentPlanLoopRun,
  AgentPlanLoopSession,
} from "@/definition/AgentPlanLoopRun";

/** How a restart treats the nodes of the loops of an unfinished run. */
export interface LoopRecoveryActions {
  /** Ends the processes a node's session left behind and reports its closeout. */
  readonly end: (node: AgentPlanStepResult) => Promise<AgentPlanStepResult>;
  /** Marks a node that was unfinished when the server stopped. */
  readonly interrupt: (node: AgentPlanStepResult) => AgentPlanStepResult;
}

const UNFINISHED = new Set(["waiting", "running", "paused"]);

async function interruptedIteration(
  iteration: AgentPlanLoopIteration,
  actions: LoopRecoveryActions,
): Promise<AgentPlanLoopIteration> {
  const nodes = await Promise.all(iteration.nodes.map(actions.end));
  // A completed iteration stays as it was written; only its sessions' cleanup is settled.
  if (iteration.status === "succeeded") return { ...iteration, nodes };
  return {
    ...iteration,
    status: iteration.status === "cancelled" ? "cancelled" : "failed",
    endedAt: iteration.endedAt ?? new Date().toISOString(),
    error: iteration.error ?? "plan_interrupted",
    nodes: nodes.map(actions.interrupt),
  };
}

/** A session that was open when the server stopped is lost; its ID proves nothing. */
function lostSession(session: AgentPlanLoopSession): AgentPlanLoopSession {
  return session.state === "open" ? { ...session, state: "lost" } : session;
}

/** A lost session reports the closeout the restart settled for its latest turn, not the one stored before it. */
function settledSession(
  session: AgentPlanLoopSession,
  iterations: readonly AgentPlanLoopIteration[],
): AgentPlanLoopSession {
  const lost = lostSession(session);
  const latest = iterations
    .flatMap((iteration) => iteration.nodes)
    .filter((node) => node.id === session.nodeId && node.session)
    .at(-1)?.session;
  return latest ? { ...lost, closeout: latest.closeout } : lost;
}

function interruptedCleanup(
  loop: AgentPlanLoopRun,
  hasFailedCleanup: boolean,
): AgentPlanLoopRun["cleanup"] {
  if (hasFailedCleanup) return "failed";
  return loop.sessions.length > 0 ? "confirmed" : loop.cleanup;
}

/**
 * Settles the loops of a run that was interrupted by a restart.
 *
 * @param loops - The loop states as stored.
 * @param actions - How the nodes of the run are ended and marked.
 * @returns The loops with every unfinished iteration failed as
 * `plan_interrupted`. Nothing runs again by itself: completed iterations stay
 * completed, and an open session is reported lost, never as live.
 */
export async function interruptedLoopRuns(
  loops: readonly AgentPlanLoopRun[],
  actions: LoopRecoveryActions,
): Promise<readonly AgentPlanLoopRun[]> {
  return Promise.all(
    loops.map(async (loop): Promise<AgentPlanLoopRun> => {
      const iterations = await Promise.all(
        loop.iterations.map((iteration) =>
          interruptedIteration(iteration, actions),
        ),
      );
      const hasFailedCleanup = iterations.some((iteration) =>
        iteration.nodes.some((node) => node.session?.closeout === "failed"),
      );
      if (!UNFINISHED.has(loop.status))
        return {
          ...loop,
          iterations,
          sessions: loop.sessions.map(lostSession),
        };
      return {
        ...loop,
        iterations,
        status: loop.status === "waiting" ? "waiting" : "failed",
        error: loop.status === "waiting" ? null : "plan_interrupted",
        cleanup: interruptedCleanup(loop, hasFailedCleanup),
        endedAt: loop.status === "waiting" ? null : new Date().toISOString(),
        sessions: loop.sessions.map((session) =>
          settledSession(session, iterations),
        ),
      };
    }),
  );
}
