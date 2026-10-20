import type { LoopSessionTerms } from "../loop/AgentPlanLoopSession";
import type { AgentPlanSnapshot } from "../AgentPlanSnapshot";

/** How one node of a resumed run is told about its earlier attempt. */
export interface PlanRecoveryTerms {
  /** Precedes the assignment; empty for a node that never started before. */
  readonly note: string;
  /** The native session the adapter resumes; `null` opens a new one. */
  readonly resumeSessionId: string | null;
}

function noteText(
  sourceRunId: string,
  mode: "native_resume" | "new_session",
): string {
  return [
    "## Pages recovery notice",
    "",
    `An earlier run of this plan (${sourceRunId}) stopped before this node finished. This is a new attempt ${mode === "native_resume" ? "that continues the earlier agent session" : "in a new agent session, which does not remember the earlier attempt"}.`,
    "Files, branches, tickets or other effects of the earlier attempt may already exist. Inspect the current state first, keep what is correct, and do not repeat a completed external action without checking it. Then complete the assignment below.",
    "",
    "",
  ].join("\n");
}

/**
 * The recovery note and native session of a node in a resumed run.
 *
 * @param snapshot - The frozen plan of the run; only a resumed run carries a directive.
 * @param stepId - The node.
 * @param terms - Its session container, and the loop iteration of a loop member.
 *
 * @remarks
 * Only a node that had started in the earlier run gets the note: a loop
 * member only in the iteration that the earlier run left unfinished. Work
 * that never started before runs as in a new run, except that a group
 * member joins the group's continued session.
 */
export function planRecoveryTerms(
  snapshot: AgentPlanSnapshot,
  stepId: string,
  terms: {
    readonly sessionGroup: string | undefined;
    readonly loop: LoopSessionTerms | null;
  },
): PlanRecoveryTerms {
  const directive = snapshot.recovery;
  if (!directive) return { note: "", resumeSessionId: null };
  const { loop } = terms;
  // Whichever member of a group opens the group's session first continues the earlier one.
  const resumeSessionId =
    directive.mode === "native_resume" && !loop
      ? (directive.resumeSessions[terms.sessionGroup ?? stepId] ?? null)
      : null;
  const isRetried = loop
    ? directive.loopIterations[loop.loopId] === loop.iteration
    : directive.retriedStepIds.includes(stepId);
  if (!isRetried) return { note: "", resumeSessionId };
  return {
    note: noteText(
      directive.sourceRunId,
      resumeSessionId === null ? "new_session" : "native_resume",
    ),
    resumeSessionId,
  };
}
