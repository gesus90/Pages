import { z } from "zod";
import { runnerResourceErrorSchema } from "./RunnerPagesAccess";
import {
  runnerExecutionSchema,
  runnerLaunchSchema,
  runnerInterpreterSchema,
} from "./RunnerExecution.js";
import { toolInventorySchema } from "./RemoteSetup.js";
import { planStepExecutionSchema } from "./AgentPlanExecution.js";
import type { ToolInventory } from "./RemoteSetup.js";
import { runnerLiveBatchSchema } from "./RunnerLiveHistory";
import { runnerTerminalSchema } from "./RunnerTerminal";
import {
  runnerCancellationSchema,
  runnerQueueReasonSchema,
} from "./RunnerCommunication";

/** Wire version shared by Pages and an outbound runner connection. */
export const RUNNER_PROTOCOL_VERSION = 1;

/** Runner 1.10: one atomic, monotonically numbered inventory of the authenticated remote host. */
export const runnerCatalogSchema = z.object({
  generation: z.number().int().positive().safe(),
  checkedAt: z.string().datetime(),
  isComplete: z.boolean(),
  areToolsComplete: z.boolean(),
  interpreters: z.array(runnerInterpreterSchema).max(16),
  tools: z.array(toolInventorySchema).max(3),
  removedInterpreterIds: z.array(z.string().max(100)).max(16),
});
export type RunnerCatalog = z.infer<typeof runnerCatalogSchema>;
const identifier = z.string().uuid();

/** Immutable Pages identity attached by dispatch, never chosen by a runner event. */
export const runnerPlanBindingSchema = z
  .object({
    planId: identifier,
    runId: identifier,
    // A step is a plan node, whose id is a UUID only when the editor made it:
    // "start" or an id chosen in addNode is valid too, as in the execution.
    stepId: planStepExecutionSchema.shape.stepId,
    attemptId: identifier,
    planRevision: z.number().int().positive(),
  })
  .strict();
export type RunnerPlanBinding = z.infer<typeof runnerPlanBindingSchema>;

/** A job keeps its identity across transport reconnects and process interruptions. */
export const runnerJobSchema = z.object({
  jobId: identifier,
  sessionId: identifier,
  plan: runnerPlanBindingSchema.optional(),
  execution: runnerExecutionSchema.optional(),
  launch: runnerLaunchSchema.optional(),
  cancellation: runnerCancellationSchema.optional(),
  queueReason: runnerQueueReasonSchema.nullable().optional(),
  observedAt: z.string().datetime().optional(),
  liveHistoryVersion: z.literal(1).optional(),
  /** Runner 1.9.0: bounded journals without a lifetime raw-output limit. */
  outputJournalVersion: z.literal(2).optional(),
  historyCursor: z.number().int().nonnegative().safe().optional(),
  historyFailure: z.literal("journal_unreadable").optional(),
  /** A final result may arrive before its remaining bounded diagnostic packets. */
  historyLength: z.number().int().nonnegative().safe().optional(),
  status: z.enum([
    "queued",
    "accepted",
    "running",
    "completed",
    "failed",
    "interrupted",
    "lost",
  ]),
});
export type RunnerJob = z.infer<typeof runnerJobSchema>;

/** Durable state; credentials and CLI output are deliberately outside the journal. */
export const runnerStateSchema = z.object({
  version: z.literal(RUNNER_PROTOCOL_VERSION),
  sessionId: identifier,
  sequence: z.number().int().nonnegative(),
  lastEventId: identifier.nullable(),
  catalog: runnerCatalogSchema.optional(),
  communicationVersion: z.literal(1).optional(),
  runnerVersion: z.string().max(40).optional(),
  lastContactAt: z.string().datetime().optional(),
  lastEventDigest: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .optional(),
  jobs: z.array(runnerJobSchema).max(1000),
});
export type RunnerState = z.infer<typeof runnerStateSchema>;

/** The causes a runner may name for a failed OpenCode node, each a Pages agent error code. */
export const REMOTE_OPENCODE_FAILURES = [
  "plan_script_interpreter_unavailable",
  "plan_context_changed",
  "plan_workspace_conflict",
  "plan_runner_storage_failed",
  "plan_runner_admission_failed",
  "provider_auth_failed",
  "provider_quota_exhausted",
  "provider_rate_limited",
  "provider_model_not_found",
  "provider_permission_denied",
  "provider_unavailable",
  "provider_unreachable",
  "opencode_free_tier_refused",
  "opencode_acp_unsupported",
  "plan_model_unavailable",
  "plan_reasoning_unsupported",
  "opencode_acp_session_failed",
] as const;

/** Runner-to-Pages messages; every event is acknowledged only after durable storage. */
export const runnerMessageSchema = z.discriminatedUnion("type", [
  z.object({
    version: z.literal(1),
    type: z.literal("catalog"),
    sessionId: identifier,
    catalog: runnerCatalogSchema,
  }),
  z.object({
    version: z.literal(1),
    type: z.literal("heartbeat"),
    sessionId: identifier,
  }),
  z.object({
    version: z.literal(1),
    type: z.literal("reconcile"),
    sessionId: identifier,
    sequence: z.number().int().nonnegative(),
    jobs: z.array(runnerJobSchema).max(1000),
    communicationVersion: z.literal(1).optional(),
    runnerVersion: z.string().max(40).optional(),
    catalog: runnerCatalogSchema.optional(),
    interpreters: z.array(runnerInterpreterSchema).max(16).optional(),
    /** Tools the runner found and what they reported; a runner before 1.3.0 sends none. */
    tools: z.array(toolInventorySchema).max(3).optional(),
    executorVersion: z.literal(1).optional(),
    cliExecutorVersion: z.literal(1).optional(),
    githubAccessVersion: z.literal(1).optional(),
    pagesAccessVersion: z.literal(1).optional(),
    /** Runner 1.7.0 reports OpenCode's catalog and runs OpenCode nodes over ACP. */
    openCodeExecutorVersion: z.literal(1).optional(),
    /** Runner 1.8.0 supports expiring viewers and bounded CLI journal batches. */
    liveHistoryVersion: z.literal(1).optional(),
    outputJournalVersion: z.literal(2).optional(),
  }),
  z.object({
    version: z.literal(1),
    type: z.literal("event"),
    sessionId: identifier,
    eventId: identifier,
    sequence: z.number().int().positive(),
    /** A 1.8.0 progress packet reuses the immutable command already stored with the claim. */
    delta: z.literal(true).optional(),
    job: runnerJobSchema,
    history: runnerLiveBatchSchema.optional(),
    result: z
      .object({
        output: z.string().max(100_000).nullable(),
        resourceError: runnerResourceErrorSchema.optional(),
        /** A stable cause the runner recognized in an OpenCode ACP failure; never provider text. */
        failureCode: z.enum(REMOTE_OPENCODE_FAILURES).optional(),
        stderr: z.string().max(65536).optional(),
        terminal: runnerTerminalSchema.optional(),
        storageError: z
          .enum([
            "ENOSPC",
            "EDQUOT",
            "EACCES",
            "EROFS",
            "EIO",
            "journal_write_failed",
          ])
          .optional(),
        closeout: z.enum(["confirmed", "pending", "failed"]),
        exitCode: z.number().int().nullable().optional(),
        signal: z.string().max(30).nullable().optional(),
        reason: z
          .enum([
            "exit",
            "timeout",
            "cancelled",
            "output_limit",
            "lost",
            "spawn",
            "storage",
            "protocol",
            "event_limit",
            "result_limit",
          ])
          .nullable()
          .optional(),
      })
      .strict()
      .optional(),
  }),
]);
export type RunnerMessage = z.infer<typeof runnerMessageSchema>;

/** The durable token is disclosed once, only to a runner holding a valid registration grant. */
export interface RunnerRegistrationReply {
  readonly version: 1;
  readonly type: "registered";
  readonly connectionId: string;
  readonly runnerId: string;
  readonly sessionId: string;
  readonly token: string | null;
  readonly heartbeatMilliseconds: number;
}

/** Pages-to-runner responses. Reconciliation never implicitly restarts a job. */
export type RunnerReply =
  | {
      readonly version: 1;
      readonly type: "catalog-ack";
      readonly sessionId: string;
      readonly generation: number;
    }
  | {
      readonly version: 1;
      readonly type: "observation";
      readonly planId: string;
      readonly leaseMilliseconds: number;
      readonly refresh: boolean;
    }
  | { readonly version: 1; readonly type: "refresh-tools" }
  | { readonly version: 1; readonly type: "dispatch"; readonly job: RunnerJob }
  | {
      readonly version: 1;
      readonly type: "cancel";
      readonly jobId: string;
      readonly sessionId?: string;
      readonly attemptId?: string;
      readonly requestedAt?: string;
    }
  | {
      readonly version: 1;
      readonly type: "heartbeat";
      readonly sessionId: string;
    }
  | {
      readonly version: 1;
      readonly type: "ack";
      readonly eventId: string;
      readonly sequence: number;
    }
  | {
      readonly version: 1;
      readonly type: "reconcile";
      readonly state: RunnerState;
      readonly outputJournalVersion?: 2;
      readonly communicationVersion?: 1;
    };

/** Secret-free remote row in Settings → Agents. Only registered SSH connections appear. */
export interface RunnerConnectionView {
  readonly connectionId: string;
  readonly name: string;
  readonly endpoint: string;
  readonly departmentName: string | null;
  readonly checkedAt: string | null;
  readonly isStable: boolean;
  readonly runnerId: string | null;
  readonly isOnline: boolean;
  readonly needsPairing?: boolean;
  /** `null` while the runner has not reported an inventory; an empty list means none found. */
  readonly tools: readonly ToolInventory[] | null;
  /** Null until reconciliation; 1 means the old executor still has a cumulative output cap. */
  readonly outputJournalVersion?: 1 | 2 | null;
  readonly runnerVersion?: string | null;
  readonly communicationVersion?: 1 | null;
}
