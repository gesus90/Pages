import { z } from "zod";
import { runnerTerminalSchema } from "./RunnerTerminal";
import { planRemoteResourceSchema } from "./AgentPlanRemoteAccess";

const identifier = z.string().min(1).max(100);

/** An explicit remote choice never falls back to execution on the Pages host. */
export const planExecutionTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("local") }).strict(),
  z.object({ kind: z.literal("remote"), workspaceId: identifier }).strict(),
]);
export type AgentPlanExecutionTarget = z.infer<
  typeof planExecutionTargetSchema
>;

/** Authorized metadata of a registered target, without SSH or provider credentials. */
export const planRemoteTargetSchema = z
  .object({
    kind: z.literal("remote"),
    connectionId: identifier,
    connectionRevision: z.number().int().positive(),
    connectionName: z.string().max(200),
    workspaceId: identifier,
    workspaceRevision: z.number().int().positive(),
    workspaceName: z.string().max(200),
    path: z.string().max(4096),
  })
  .strict();
export type AgentPlanRemoteTarget = z.infer<typeof planRemoteTargetSchema>;

/** Immutable initial attempt identity and requested execution context of one run step. */
export const planStepExecutionSchema = z
  .object({
    schemaVersion: z.literal(1),
    resources: z.array(planRemoteResourceSchema).max(64).optional(),
    planId: identifier,
    runId: identifier,
    stepId: identifier,
    attemptId: z.string().uuid(),
    planRevision: z.number().int().positive(),
    target: z.union([
      z.object({ kind: z.literal("local") }).strict(),
      planRemoteTargetSchema,
    ]),
    workspace: z
      .object({
        id: identifier,
        path: z.string().max(4096),
        revision: z.number().int().positive(),
      })
      .strict(),
    modelAccess: z
      .object({
        connectionId: identifier.nullable(),
        connectionName: z.string().max(200),
        provider: z.string().max(100),
        model: z.string().max(500),
        reasoningEffort: z.string().max(100).nullable(),
      })
      .strict(),
  })
  .strict();
export type AgentPlanStepExecution = z.infer<typeof planStepExecutionSchema>;

/** Safe progress reported for a bound remote attempt; unconfirmed cleanup retains reservations. */
export const planRemoteProgressSchema = z
  .object({
    jobId: z.string().uuid(),
    sessionId: z.string().uuid(),
    status: z.enum([
      "accepted",
      "running",
      "completed",
      "failed",
      "interrupted",
      "lost",
    ]),
    launchId: z.string().uuid().optional(),
    liveHistoryVersion: z.literal(1).optional(),
    outputJournalVersion: z.literal(2).optional(),
    terminal: runnerTerminalSchema.optional(),
    storageError: z.string().max(40).optional(),
    reason: z.string().max(30).nullable().optional(),
    stderr: z.string().max(65536).optional(),
    exitCode: z.number().int().nullable().optional(),
    signal: z.string().nullable().optional(),
    startedAt: z.string().datetime().nullable(),
    endedAt: z.string().datetime().nullable(),
    closeout: z.enum(["confirmed", "pending", "failed"]),
  })
  .strict();
export type AgentPlanRemoteProgress = z.infer<typeof planRemoteProgressSchema>;
