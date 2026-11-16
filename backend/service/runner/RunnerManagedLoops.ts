import { isActivePlanRun } from "@/definition/AgentPlanRunState";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type {
  AgentPlanLoopRun,
  AgentPlanLoopSession,
} from "@/definition/AgentPlanLoopRun";

/** Settles ended loop ownership from confirmed runner records without changing accepted iterations. */
export function settleManagedRunnerLoops(run: AgentPlanRun): AgentPlanRun {
  if (isActivePlanRun(run.status) || !run.loops) return run;
  return { ...run, loops: run.loops.map((loop) => settleLoop(run, loop)) };
}

function settleLoop(
  run: AgentPlanRun,
  loop: AgentPlanLoopRun,
): AgentPlanLoopRun {
  const nodes = loop.iterations.flatMap((iteration) => iteration.nodes);
  if (!nodes.some(hasManagedRecord)) return loop;
  const sessions = loop.sessions.map((session) =>
    settleSession(session, nodes),
  );
  const hasPendingJob = run.runnerJobs?.some(
    (job) => job.ownerStepId === loop.id && job.closeout !== "confirmed",
  );
  const isConfirmed =
    !hasPendingJob &&
    nodes.every(hasConfirmedRecords) &&
    sessions.every(
      (session) =>
        session.state !== "open" &&
        (session.closeout === "confirmed" || session.closeout === "not_needed"),
    );
  return {
    ...loop,
    sessions,
    cleanup: isConfirmed ? "confirmed" : loop.cleanup,
  };
}

function hasManagedRecord(node: AgentPlanStepResult): boolean {
  return Boolean(
    node.session?.runnerOwned === true ||
    node.session?.runnerJob !== undefined ||
    node.script?.runnerOwned === true ||
    node.script?.runnerJob !== undefined,
  );
}

function hasConfirmedRecords(node: AgentPlanStepResult): boolean {
  const session = node.session;
  const script = node.script;
  if (
    session &&
    session.closeout !== "confirmed" &&
    session.closeout !== "not_needed"
  )
    return false;
  return !script || script.closeout === "confirmed";
}

function settleSession(
  session: AgentPlanLoopSession,
  nodes: readonly AgentPlanStepResult[],
): AgentPlanLoopSession {
  const latest = nodes
    .filter(
      (node) =>
        node.id === session.nodeId &&
        node.session?.instanceId === session.instanceId,
    )
    .at(-1)?.session;
  if (
    !latest ||
    (!latest.runnerOwned && !latest.runnerJob) ||
    latest.closeout !== "confirmed"
  )
    return session;
  return {
    ...session,
    state: session.state === "open" ? "closed" : session.state,
    closeout: "confirmed",
  };
}
