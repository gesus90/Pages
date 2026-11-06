import { z } from "zod";

import { runnerExecutionSchema } from "./RunnerExecution";
import { runnerPlanBindingSchema } from "./RunnerProtocol";

export const PAGES_RUNNER_TIMEOUT_MS = 5_000;
export const PAGES_RUNNER_MAX_BYTES = 2_000_000;
const identity = {
  version: z.literal(1),
  connectionId: z.string().min(1).max(200),
};
const actor = { ...identity, userId: z.string().min(1).max(200) };
const step = {
  version: z.literal(1),
  runId: z.string().min(1),
  stepId: z.string().min(1),
  attemptId: z.string().min(1),
};

/** Only the run service's required operations cross the private API socket. */
export const pagesRunnerRequestSchema = z.discriminatedUnion("operation", [
  z.object({ ...identity, operation: z.literal("facts") }).strict(),
  z.object({ ...actor, operation: z.literal("ready") }).strict(),
  z.object({ ...actor, operation: z.literal("providerCatalog") }).strict(),
  z
    .object({
      ...actor,
      operation: z.enum(["enqueue", "enqueueRetry"]),
      plan: runnerPlanBindingSchema,
      execution: runnerExecutionSchema,
    })
    .strict(),
  z
    .object({
      ...identity,
      operation: z.enum(["cancel", "pauseQueued"]),
      jobId: z.string().min(1),
    })
    .strict(),
  z
    .object({ ...step, operation: z.enum(["openPages", "closePages"]) })
    .strict(),
]);
export type PagesRunnerRequest = z.infer<typeof pagesRunnerRequestSchema>;

/** Live capabilities expire with their source observation; durable progress is read from PostgreSQL. */
export const pagesRunnerFactsSchema = z.object({
  availability: z
    .enum([
      "remoteIdentity",
      "remoteOffline",
      "remoteRunnerUpdate",
      "remoteCatalogStale",
    ])
    .nullable(),
  pages: z.boolean(),
  assets: z.boolean(),
  openCode: z.boolean(),
  exactPayload: z.boolean(),
  continuation: z.boolean(),
  contact: z.object({
    state: z.enum(["connected", "lost"]),
    lastContactAt: z.string().nullable(),
  }),
});
export type PagesRunnerFacts = z.infer<typeof pagesRunnerFactsSchema>;

/** All RPC answers carry the protocol version and keep unexpected server details private. */
export const pagesRunnerReplySchema = z.discriminatedUnion("ok", [
  z.object({ version: z.literal(1), ok: z.literal(true), result: z.unknown() }),
  z.object({ version: z.literal(1), ok: z.literal(false), error: z.string() }),
]);

/** Dispatch gates retain their domain meaning across process boundaries. */
export const PAGES_RUNNER_DISPATCH_ERRORS = {
  PAUSED: "dispatch_paused",
  CANCELLED: "dispatch_cancelled",
} as const;
