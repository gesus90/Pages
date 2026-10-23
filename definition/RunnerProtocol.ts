import { z } from "zod";
import {
  runnerExecutionSchema,
  runnerLaunchSchema,
  runnerInterpreterSchema,
} from "./RunnerExecution.js";
import { toolInventorySchema } from "./RemoteSetup.js";
import { planStepExecutionSchema } from "./AgentPlanExecution.js";
import type { ToolInventory } from "./RemoteSetup.js";

/** Wire version shared by Pages and an outbound runner connection. */
export const RUNNER_PROTOCOL_VERSION = 1;
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
  lastEventDigest: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .optional(),
  jobs: z.array(runnerJobSchema).max(1000),
});
export type RunnerState = z.infer<typeof runnerStateSchema>;

/** Runner-to-Pages messages; every event is acknowledged only after durable storage. */
export const runnerMessageSchema = z.discriminatedUnion("type", [
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
    interpreters: z.array(runnerInterpreterSchema).max(16).optional(),
    /** Tools the runner found and what they reported; a runner before 1.3.0 sends none. */
    tools: z.array(toolInventorySchema).max(3).optional(),
    executorVersion: z.literal(1).optional(),
  }),
  z.object({
    version: z.literal(1),
    type: z.literal("event"),
    sessionId: identifier,
    eventId: identifier,
    sequence: z.number().int().positive(),
    job: runnerJobSchema,
    result: z
      .object({
        output: z.string().max(100_000).nullable(),
        stderr: z.string().max(65536).optional(),
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
  | { readonly version: 1; readonly type: "dispatch"; readonly job: RunnerJob }
  | { readonly version: 1; readonly type: "cancel"; readonly jobId: string }
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
  /** `null` while the runner has not reported an inventory; an empty list means none found. */
  readonly tools: readonly ToolInventory[] | null;
}
