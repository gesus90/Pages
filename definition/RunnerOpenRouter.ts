import { z } from "zod";

const modelId = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9/~_.:+-]+$/u);

/** A limit the provider stated; absent or `null` means the catalog did not say. */
const statedLimit = z.number().int().positive().nullable().optional();

/** One model of the runner's catalog with only the limits the provider stated. */
const catalogModelSchema = z
  .object({
    id: modelId,
    name: z.string().max(300),
    contextLength: statedLimit,
    maxOutputTokens: statedLimit,
  })
  .strict();

/**
 * Usage of the key as the provider states it.
 *
 * @remarks
 * A figure the provider did not state is `null`, never zero. The reset is a
 * cadence the provider names, not a point in time, and is kept apart from run
 * durations and session lifetimes, which no provider reports here.
 */
export const runnerKeyUsageSchema = z
  .object({
    used: z.number().nonnegative().nullable(),
    limit: z.number().nonnegative().nullable(),
    remaining: z.number().nonnegative().nullable(),
    resets: z.enum(["daily", "weekly", "monthly"]).nullable(),
  })
  .strict();
export type RunnerKeyUsage = z.infer<typeof runnerKeyUsageSchema>;

/** Provider credentials travel only in an authenticated, transient channel command. */
export const runnerOpenRouterCommandSchema = z.discriminatedUnion("operation", [
  z
    .object({
      version: z.literal(1),
      type: z.literal("openrouter"),
      requestId: z.string().uuid(),
      operation: z.literal("catalog"),
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      type: z.literal("openrouter"),
      requestId: z.string().uuid(),
      operation: z.literal("sync"),
      apiKey: z
        .string()
        .trim()
        .min(16)
        .max(512)
        .regex(/^[\x21-\x7e]+$/u)
        .optional(),
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      type: z.literal("openrouter"),
      requestId: z.string().uuid(),
      operation: z.literal("check"),
      model: modelId,
    })
    .strict(),
]);
export type RunnerOpenRouterCommand = z.infer<
  typeof runnerOpenRouterCommandSchema
>;

/** Allowlisted results exclude provider bodies, credentials and arbitrary chat output. */
export const runnerOpenRouterResultSchema = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("catalog"),
      ok: z.literal(true),
      freeModels: z.array(catalogModelSchema).max(1000),
      syncedAt: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("sync"),
      ok: z.literal(true),
      keyStatus: z.literal(200),
      totalModels: z.number().int().nonnegative().max(10_000),
      freeModels: z.array(catalogModelSchema).max(1000),
      syncedAt: z.string().datetime(),
      usage: runnerKeyUsageSchema.optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("check"),
      ok: z.literal(true),
      keyStatus: z.literal(200),
      chatStatus: z.literal(200),
      model: modelId,
      hasReply: z.boolean(),
      isOkReply: z.boolean(),
      usage: runnerKeyUsageSchema.optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("failed"),
      ok: z.literal(false),
      upstreamStatus: z.number().int().min(100).max(599).nullable(),
    })
    .strict(),
]);
export type RunnerOpenRouterResult = z.infer<
  typeof runnerOpenRouterResultSchema
>;

/** Correlates a secret-free provider result with one pending channel command. */
export const runnerOpenRouterReplySchema = z
  .object({
    version: z.literal(1),
    type: z.literal("openrouter-result"),
    requestId: z.string().uuid(),
    result: runnerOpenRouterResultSchema,
  })
  .strict();
