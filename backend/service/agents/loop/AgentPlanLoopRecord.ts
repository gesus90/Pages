import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type {
  AgentPlanLoop,
  AgentPlanLoopMember,
} from "@/definition/AgentPlanLoop";
import type {
  AgentPlanLoopCount,
  AgentPlanLoopIteration,
  AgentPlanLoopRun,
  AgentPlanLoopSession,
} from "@/definition/AgentPlanLoopRun";
import type { AgentPlanSnapshot } from "../AgentPlanSnapshot";

/** The identity of an iteration: the loop and its number. */
export function loopIterationId(loopId: string, number: number): string {
  return `${loopId}#${number}`;
}

/** The state of a loop that has not started. */
export function initialLoopRun(loop: AgentPlanLoop): AgentPlanLoopRun {
  return {
    id: loop.id,
    name: loop.name,
    status: "waiting",
    count: null,
    sessionPolicy: loop.sessionPolicy,
    condition: null,
    iterations: [],
    sessions: [],
    completion: null,
    cleanup: "not_needed",
    startedAt: null,
    endedAt: null,
    error: null,
  };
}

/** The initial state of every loop of a snapshot. */
export function initialLoopRuns(
  snapshot: AgentPlanSnapshot,
): readonly AgentPlanLoopRun[] {
  return snapshot.plan.nodes.flatMap((node) =>
    node.type === "loop" ? [initialLoopRun(node)] : [],
  );
}

/** Records what the loop resolved once before its first iteration. */
export function startedLoopRun(
  record: AgentPlanLoopRun,
  loop: AgentPlanLoop,
  count: AgentPlanLoopCount,
): AgentPlanLoopRun {
  const { condition } = loop;
  return {
    ...record,
    status: "running",
    count,
    sessionPolicy: loop.sessionPolicy,
    condition: condition
      ? {
          isActive: loop.countMode === "max" && condition.isEnabled,
          sourceNodeId: condition.sourceNodeId,
          outputPath: condition.outputPath,
          expected: condition.expected,
        }
      : null,
    startedAt: record.startedAt ?? new Date().toISOString(),
  };
}

function waitingNode(
  member: AgentPlanLoopMember,
  name: string,
): AgentPlanStepResult {
  return {
    id: member.id,
    name,
    status: "waiting",
    isBlocked: false,
    cancellation: "none",
    output: null,
    error: null,
  };
}

/** Appends the next iteration with every member waiting. */
export function beginIteration(
  record: AgentPlanLoopRun,
  loop: AgentPlanLoop,
  names: ReadonlyMap<string, string>,
): AgentPlanLoopRun {
  const number = record.iterations.length + 1;
  const iteration: AgentPlanLoopIteration = {
    id: loopIterationId(loop.id, number),
    number,
    status: "running",
    startedAt: new Date().toISOString(),
    endedAt: null,
    nodes: loop.steps.map((member) =>
      waitingNode(member, names.get(member.id) ?? member.id),
    ),
    condition: { state: "not_evaluated", reason: "incomplete" },
    error: null,
  };
  return { ...record, iterations: [...record.iterations, iteration] };
}

/** Changes one iteration; the others, finished ones included, stay as they are. */
export function patchIteration(
  record: AgentPlanLoopRun,
  number: number,
  changes: Partial<AgentPlanLoopIteration>,
): AgentPlanLoopRun {
  return {
    ...record,
    iterations: record.iterations.map((iteration) =>
      iteration.number === number ? { ...iteration, ...changes } : iteration,
    ),
  };
}

/** Changes the result of one member in one iteration. */
export function patchIterationNode(
  record: AgentPlanLoopRun,
  target: { readonly number: number; readonly nodeId: string },
  changes: Partial<AgentPlanStepResult>,
): AgentPlanLoopRun {
  const iteration = record.iterations.find(
    (entry) => entry.number === target.number,
  );
  if (!iteration) return record;
  return patchIteration(record, target.number, {
    nodes: iteration.nodes.map((node) =>
      node.id === target.nodeId ? { ...node, ...changes } : node,
    ),
  });
}

/** The record with the session lifecycle of its agents brought up to date from the recorded turns. */
export function withLoopSessions(
  record: AgentPlanLoopRun,
  loop: AgentPlanLoop,
  runId: string,
): AgentPlanLoopRun {
  return { ...record, sessions: loopSessionsOf(record, loop, runId, true) };
}

/**
 * Derives the lifecycle of each agent member's session from the recorded turns.
 *
 * @param record - The loop's state.
 * @param loop - The frozen loop.
 * @param runId - The Pages run the loop belongs to.
 * @param isOpenAllowed - Whether the loop is still running, so a session
 * whose last turn succeeded counts as open rather than closed.
 */
export function loopSessionsOf(
  record: AgentPlanLoopRun,
  loop: AgentPlanLoop,
  runId: string,
  isOpenAllowed: boolean,
): readonly AgentPlanLoopSession[] {
  return loop.steps.flatMap((member): AgentPlanLoopSession[] => {
    if (member.type !== "agent") return [];
    const turns = record.iterations.flatMap((iteration) =>
      iteration.nodes.filter((node) => node.id === member.id && node.session),
    );
    const session = describeSession(turns, record, isOpenAllowed);
    // A member that has not taken a turn has no session to describe yet.
    if (!session) return [];
    return [
      {
        ...session,
        nodeId: member.id,
        key: `${runId}/${loop.id}/${member.id}`,
      },
    ];
  });
}

function describeSession(
  turns: readonly AgentPlanStepResult[],
  record: AgentPlanLoopRun,
  isOpenAllowed: boolean,
): Omit<AgentPlanLoopSession, "nodeId" | "key"> | null {
  const last = turns.at(-1)?.session ?? null;
  if (!last) return null;
  return {
    policy: record.sessionPolicy,
    state: sessionState(record, {
      isLost: isSessionLost(turns, record),
      isOpenAllowed,
      closeout: last.closeout,
    }),
    createdInIteration: turns.at(0)?.session?.loop?.iteration ?? null,
    turns: last.loop?.turn ?? turns.length,
    ...sessionIdentities(last),
    closeout: last.closeout,
  };
}

/** A stop ends the processes on purpose; that is a closed session, not a lost one. */
function isSessionLost(
  turns: readonly AgentPlanStepResult[],
  record: AgentPlanLoopRun,
): boolean {
  return record.status !== "cancelled" && turns.some(isLostSession);
}

function sessionIdentities(
  last: NonNullable<AgentPlanStepResult["session"]>,
): Pick<
  AgentPlanLoopSession,
  "instanceId" | "acpSessionId" | "nativeSessionId"
> {
  return {
    instanceId: last.instanceId,
    acpSessionId: last.loop?.acpSessionId ?? last.sessionId,
    nativeSessionId: last.loop?.nativeSessionId ?? null,
  };
}

function isLostSession(node: AgentPlanStepResult): boolean {
  return (
    node.error === "plan_loop_session_lost" ||
    node.error === "plan_group_session_lost" ||
    (node.session?.events ?? []).some((line) =>
      line.startsWith("resource session retired"),
    )
  );
}

function sessionState(
  record: AgentPlanLoopRun,
  facts: {
    readonly isLost: boolean;
    readonly isOpenAllowed: boolean;
    readonly closeout: AgentPlanLoopSession["closeout"];
  },
): AgentPlanLoopSession["state"] {
  if (record.sessionPolicy === "fresh") return "not_retained";
  if (facts.isLost) return "lost";
  return facts.isOpenAllowed && facts.closeout === "pending"
    ? "open"
    : "closed";
}
