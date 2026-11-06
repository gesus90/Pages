import { z } from "zod";

const identity = z.string().min(1).max(256);
const target = { actorId: identity, targetId: identity };

/** Durable intent contains identifiers only, never a token or copied user permissions. */
export const gitHubCommandSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("scheduled") }),
  z.object({ ...target, operation: z.literal("project") }),
  z.object({ ...target, operation: z.literal("single") }),
  z.object({ ...target, operation: z.literal("publish") }),
  z.object({ ...target, operation: z.literal("test") }),
  z.object({
    ...target,
    operation: z.literal("import"),
    issueNumber: z.number().int().positive(),
  }),
  z.object({ ...target, operation: z.literal("link"), externalId: identity }),
  z.object({
    ...target,
    operation: z.literal("resolve"),
    resolution: z.enum(["pages", "github"]),
  }),
]);

/** Typed requests crossing the process boundary. */
export type GitHubCommand = z.infer<typeof gitHubCommandSchema>;

const counter = z.number().int().nonnegative();
/** Results carry no remote payload, only the existing counters or local identifiers. */
export const gitHubResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("scheduled"),
    completed: counter,
    failed: counter,
  }),
  z.object({ kind: z.literal("void") }),
  z.object({ kind: z.literal("boolean"), result: z.boolean() }),
  z.object({ kind: z.literal("task"), id: identity }),
  z.object({
    kind: z.literal("summary"),
    summary: z.object({
      pushed: counter,
      pulled: counter,
      created: counter,
      detected: counter,
      conflicts: counter,
      pullRequests: counter,
    }),
  }),
  z.object({ kind: z.literal("error"), code: z.string().max(128) }),
]);

/** Persisted reply, validated again by the waiting process. */
export type GitHubJobResult = z.infer<typeof gitHubResultSchema>;
