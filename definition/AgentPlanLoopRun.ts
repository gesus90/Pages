import type { AgentPlanStepResult, AgentPlanStepStatus } from "./AgentPlan";
import type {
  AgentPlanLoopCountMode,
  AgentPlanLoopRunsSource,
  AgentPlanLoopSessionPolicy,
  AgentPlanLoopValue,
} from "./AgentPlanLoop";
import type { AgentPlanLoopSessionLink } from "./AgentPlanSession";

/**
 * Why a loop ended regularly.
 *
 * @remarks
 * `count_reached` says only that the number of iterations was used up; it
 * never claims that a review condition came true. `condition_met` is the
 * early end of a `max` loop. `while_false` ends a while loop whose boolean
 * was `false` before an iteration, the first one included.
 */
export type AgentPlanLoopCompletion =
  "count_reached" | "condition_met" | "while_false";

/**
 * One check of a while loop before an iteration.
 *
 * @remarks
 * Every check reads its value anew: the bound boolean before the first
 * iteration, then the newest result of the source member, or the bound
 * boolean again. A decision is never reused for a later iteration.
 */
export interface AgentPlanLoopWhileCheck {
  /** The iteration the check decided about, counting from 1. */
  readonly before: number;
  readonly source: "parameter" | "member";
  readonly value: boolean;
  readonly at: string;
}

/** Why an end condition could not be evaluated; each is a failure, never a silent `false`. */
export type AgentPlanLoopConditionFailure =
  | "plan_loop_condition_source"
  | "plan_loop_condition_path"
  | "plan_loop_output_missing"
  | "plan_loop_output_invalid"
  | "plan_loop_output_ambiguous"
  | "plan_loop_condition_field"
  | "plan_loop_condition_type";

/** The value the condition found at its path, as far as the comparison used it. */
export type AgentPlanLoopFound =
  AgentPlanLoopValue | { readonly type: "object" | "array" };

/**
 * What the end condition made of one iteration.
 *
 * @remarks
 * `not_evaluated` is a fact, not a verdict: the condition is off, the loop
 * counts `expected`, or the iteration did not complete.
 */
export type AgentPlanLoopConditionOutcome =
  | {
      readonly state: "not_evaluated";
      readonly reason: "disabled" | "expected" | "incomplete";
    }
  | {
      readonly state: "evaluated";
      readonly isMet: boolean;
      readonly found: AgentPlanLoopFound;
    }
  | {
      readonly state: "failed";
      readonly code: AgentPlanLoopConditionFailure;
    };

/** One run of the loop's subgraph, with its own identity, results and times. */
export interface AgentPlanLoopIteration {
  /** The loop's node ID and the iteration, as `loopId#number`. */
  readonly id: string;
  /** Counts from 1. */
  readonly number: number;
  readonly status: AgentPlanStepStatus;
  readonly startedAt: string;
  readonly endedAt: string | null;
  /** The results of the members in this iteration; earlier iterations keep theirs. */
  readonly nodes: readonly AgentPlanStepResult[];
  readonly condition: AgentPlanLoopConditionOutcome;
  readonly error: string | null;
}

/**
 * The lifecycle of the session of one agent member across iterations.
 *
 * @remarks
 * `open` is a live session that continues with the next turn; `closed` was
 * ended on purpose and confirmed; `lost` ended without Pages closing it and is
 * never replaced under the same identity; `not_retained` belongs to the
 * `fresh` policy, where each iteration opens and ends its own session.
 */
export type AgentPlanLoopSessionState =
  "open" | "closed" | "lost" | "not_retained";

/**
 * The session of one agent member in this run of the loop.
 *
 * @remarks
 * The Pages run, loop and node identifiers, the ACP session ID the adapter
 * issued, the native ID an adapter may report separately, and the process
 * instance stay apart. `acpSessionId` and `nativeSessionId` are only ever
 * values an adapter reported.
 */
export interface AgentPlanLoopSession {
  readonly nodeId: string;
  /** The stable key of the session, `runId/loopId/nodeId`; the iteration is no part of it. */
  readonly key: string;
  readonly policy: AgentPlanLoopSessionPolicy;
  readonly state: AgentPlanLoopSessionState;
  /** The iteration whose turn opened the session; `null` before the first turn. */
  readonly createdInIteration: number | null;
  /** Turns sent to the session so far. */
  readonly turns: number;
  readonly instanceId: string | null;
  readonly acpSessionId: string | null;
  readonly nativeSessionId: string | null;
  readonly closeout: "pending" | "confirmed" | "failed" | "not_needed";
}

/** The count and mode a loop resolved once before its first iteration. */
export interface AgentPlanLoopCount {
  /**
   * Where the number came from: the saved value, a parameter, the count of a
   * stack, or `while` for a while loop, whose number is only its upper limit.
   */
  readonly source: AgentPlanLoopRunsSource | "stack" | "while";
  /** The bound node: the parameter of a bound count or a while loop, the stack of a stack count. */
  readonly parameterId: string | null;
  /**
   * The effective number of iterations, 0 to 999; never changed while the loop runs.
   *
   * @remarks
   * A bound 0 runs no iteration. A while loop stores its limit here.
   */
  readonly effective: number;
  readonly mode: AgentPlanLoopCountMode;
}

/**
 * The state of one loop in a run: what it resolved, what each iteration did, how it ended.
 *
 * @remarks
 * Persisted with the run, so a restart finds completed iterations as they
 * were; an interrupted one is reported as failed with `plan_interrupted`
 * and nothing runs again by itself.
 */
export interface AgentPlanLoopRun {
  /** The loop node's ID, which is also the ID of its entry in the run's steps. */
  readonly id: string;
  readonly name: string;
  readonly status: AgentPlanStepStatus;
  /** Absent before the loop started and resolved its count. */
  readonly count: AgentPlanLoopCount | null;
  readonly sessionPolicy: AgentPlanLoopSessionPolicy;
  readonly condition: {
    readonly isActive: boolean;
    readonly sourceNodeId: string;
    readonly outputPath: string;
    readonly expected: AgentPlanLoopValue;
  } | null;
  readonly iterations: readonly AgentPlanLoopIteration[];
  readonly sessions: readonly AgentPlanLoopSession[];
  /** The checks of a while loop, oldest first; absent for a counting loop. */
  readonly whileChecks?: readonly AgentPlanLoopWhileCheck[];
  /** Set only when the loop ended regularly and its cleanup was confirmed. */
  readonly completion: AgentPlanLoopCompletion | null;
  readonly cleanup: "not_needed" | "pending" | "confirmed" | "failed";
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly error: string | null;
}

/**
 * The durable record of one completed iteration, written once with the run.
 *
 * @remarks
 * It holds what a restart needs to know: the loop, the iteration, the count
 * and mode resolved for the loop, the verdict of the condition, and for each
 * member its status, result and the identifiers of its session. It states
 * that the iteration completed; it is no promise that a session still lives.
 */
export interface AgentPlanLoopIterationCheckpoint {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly loopId: string;
  readonly iteration: number;
  readonly completedAt: string;
  readonly count: AgentPlanLoopCount;
  readonly condition: AgentPlanLoopConditionOutcome;
  readonly nodes: readonly {
    readonly id: string;
    readonly status: AgentPlanStepStatus;
    readonly output: string | null;
    readonly outputDigest: string;
    readonly session: {
      readonly attemptId: string | null;
      readonly instanceId: string;
      readonly sessionId: string | null;
      readonly loop: AgentPlanLoopSessionLink | null;
    } | null;
  }[];
}

/**
 * Whether the whole loop was left regularly: it succeeded with a reason and a confirmed cleanup.
 *
 * @remarks
 * A running or paused loop never counts, however many iterations succeeded,
 * and neither does a failed, stopped or cancelled one or one whose cleanup is
 * still pending or failed. The reason itself stays as recorded.
 */
export function isPlanLoopLeftRegularly(
  record:
    Pick<AgentPlanLoopRun, "status" | "completion" | "cleanup"> | undefined,
): boolean {
  return (
    record?.status === "succeeded" &&
    record.completion !== null &&
    (record.cleanup === "confirmed" || record.cleanup === "not_needed")
  );
}
