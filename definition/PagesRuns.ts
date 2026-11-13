import {
  AGENT_SWARM_MAIN_OPERATIONS,
  AGENT_SWARM_WORKER_OPERATIONS,
} from "./AgentPlanSwarmOperations";
import { z } from "zod";

/** Local control-plane protocol. Durable commands live in PostgreSQL, never in the socket. */
export const PAGES_RUNS_PROTOCOL = 1;
export const PAGES_RUNS_TIMEOUT_MS = 1_000;
export const pagesRunsWakeSchema = z
  .object({
    version: z.literal(PAGES_RUNS_PROTOCOL),
    operation: z.literal("wake"),
  })
  .strict();
export const pagesRunsReplySchema = z
  .object({
    version: z.literal(PAGES_RUNS_PROTOCOL),
    accepted: z.literal(true),
  })
  .strict();
export const planRunCommandActionSchema = z.enum([
  "start",
  "pause",
  "stop",
  "resume",
]);
export type PlanRunCommandAction = z.infer<typeof planRunCommandActionSchema>;

/** A committed command acknowledgement, distinct from its eventual execution result. */
export interface PlanRunCommandReceipt {
  readonly id: string;
  readonly runId: string;
  readonly action: PlanRunCommandAction;
  readonly status: "accepted" | "applied" | "failed";
  readonly acceptedAt: string;
  readonly error?: string;
}

/** Parses an acknowledgement from a stored operation without accepting private queue fields. */
export const planRunCommandReceiptSchema = z.object({
  id: z.string(),
  runId: z.string(),
  action: planRunCommandActionSchema,
  status: z.enum(["accepted", "applied", "failed"]),
  acceptedAt: z.string(),
  error: z.string().optional(),
});

/** Recovery asks the elected owner rather than treating an API process as the engine. */
export const pagesRunsOwnershipSchema = z
  .object({
    version: z.literal(1),
    operation: z.literal("ownership"),
    runId: z.string().min(1).max(200),
  })
  .strict();
export const pagesRunsOwnershipReplySchema = z
  .object({ active: z.boolean() })
  .strict();

/** A swarm tool call the API hands to the engine process that runs the swarm (PAGE-313). */
export const pagesRunsSwarmSchema = z
  .object({
    version: z.literal(1),
    operation: z.literal("swarm"),
    runId: z.string().min(1).max(200),
    stepId: z.string().min(1).max(300),
    swarmOperation: z.enum([
      ...AGENT_SWARM_MAIN_OPERATIONS,
      ...AGENT_SWARM_WORKER_OPERATIONS,
    ]),
    parameters: z.unknown(),
  })
  .strict();

/** The answer of the engine: the result, or why the call was refused. */
export const pagesRunsSwarmReplySchema = z.union([
  z.object({ refused: z.enum(["FORBIDDEN", "INVALID_REQUEST"]) }).strict(),
  z.object({ result: z.unknown() }).strict(),
]);
