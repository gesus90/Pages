import type {
  AgentPlanGroupSessionLink,
  AgentPlanLoopSessionLink,
  AgentPlanSessionRecord,
} from "@/definition/AgentPlanSession";
import type { AgentPlanLoopSessionPolicy } from "@/definition/AgentPlanLoop";
import type {
  AgentPlanSnapshot,
  AgentPlanStepSnapshot,
} from "../AgentPlanSnapshot";

/** How one run of a loop member relates to the session of its agent node. */
export interface LoopSessionTerms {
  readonly loopId: string;
  readonly policy: AgentPlanLoopSessionPolicy;
  /** Counts from 1. */
  readonly iteration: number;
}

/**
 * The loop of a member and the policy of its session, or `null` outside loops.
 *
 * @param step - The frozen member.
 * @param snapshot - The frozen plan, which holds the loop's policy.
 * @param iteration - The iteration this run belongs to.
 */
export function loopSessionTerms(
  step: AgentPlanStepSnapshot,
  snapshot: AgentPlanSnapshot,
  iteration: number | undefined,
): LoopSessionTerms | null {
  if (step.loopId === undefined || iteration === undefined) return null;
  const loop = snapshot.plan.nodes.find(
    (node) => node.type === "loop" && node.id === step.loopId,
  );
  if (loop?.type !== "loop") return null;
  return { loopId: loop.id, policy: loop.sessionPolicy, iteration };
}

/**
 * The key part that names the session container of a node within its run.
 *
 * @remarks
 * A group member shares the group's session. A member of a loop that reuses
 * its sessions owns one session per agent node, named by loop and node; the
 * iteration is never part of it. Everything else opens a session of its own.
 */
export function planSessionGroup(
  step: AgentPlanStepSnapshot,
  terms: LoopSessionTerms | null,
): string | undefined {
  if (step.groupId !== undefined) return step.groupId;
  return terms?.policy === "reuse"
    ? `${terms.loopId}/${step.step.id}`
    : undefined;
}

const GROUP_TURN_SCOPE =
  "This is a new step in a sequential group. Only the instruction in this turn is active for this step. Earlier step instructions are completed historical context, not continuing tasks. Retain facts from that context.\n\n";

/** The prompt prefix of a turn: what a group step or a loop iteration carries over. */
export function planTurnScope(
  step: AgentPlanStepSnapshot,
  terms: LoopSessionTerms | null,
): string {
  if (step.groupId) return GROUP_TURN_SCOPE;
  return terms ? loopTurnScope(terms) : "";
}

function loopTurnScope(terms: LoopSessionTerms): string {
  const carried = sessionCarry(terms);
  return `This is iteration ${terms.iteration} of a loop. ${carried}Only the instruction and inputs in this turn are active; earlier turns of this session are your own history, not continuing tasks.\n\n`;
}

/** What this turn tells the agent about its session: kept for later runs, continued, or new. */
function sessionCarry(terms: LoopSessionTerms): string {
  if (terms.policy === "fresh")
    return "This is a new session; nothing of earlier iterations is retained. ";
  return terms.iteration === 1
    ? "This session stays open for the next iterations of the loop. "
    : "This session continues from the earlier iterations of the loop. ";
}

/**
 * How a node's record names its session: through its group, or through its loop.
 *
 * @param node - The node, with its group and its loop terms.
 * @param shared - The shared session the node joins, `null` for a node with a session of its own.
 */
export function planSessionLink(
  node: {
    readonly step: Pick<AgentPlanStepSnapshot, "groupId">;
    readonly loop: LoopSessionTerms | null;
  },
  shared: AgentPlanGroupSessionLink | null,
): Pick<AgentPlanSessionRecord, "group" | "loop"> {
  if (node.step.groupId && shared) return { group: shared };
  return node.loop ? { loop: loopSessionLink(node.loop, shared) } : {};
}

/** Marks the session role of a loop member, from the state of its session. */
function loopSessionLink(
  terms: LoopSessionTerms,
  session: {
    readonly role: "created" | "continued";
    readonly turn: number;
    readonly acpSessionId: string | null;
  } | null,
): AgentPlanLoopSessionLink {
  return {
    loopId: terms.loopId,
    iteration: terms.iteration,
    policy: terms.policy,
    role: session?.role ?? "fresh",
    turn: session?.turn ?? 1,
    acpSessionId: session?.acpSessionId ?? null,
    nativeSessionId: null,
  };
}
