import { z } from "zod";

const token = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
  .nullable();
/** Claude reports uncached input separately from both cache counters. */
export const claudeTokensSchema = z.object({
  inputTokens: token,
  outputTokens: token,
  cacheReadTokens: token,
  cacheWriteTokens: token,
});
export const claudeModelUsageSchema = claudeTokensSchema.extend({
  model: z.string().min(1).max(200),
});
/** Only accounting fields cross the raw SDK notification boundary. */
export const claudeObservationSchema = z.object({
  sessionId: z.string().min(1).max(200),
  id: z.string().min(1).max(200),
  kind: z.enum(["message", "total", "prompt"]),
  models: z.array(claudeModelUsageSchema).max(100),
});
const rate = z
  .string()
  .max(80)
  .refine(
    (text) =>
      text.trim() !== "" && Number.isFinite(Number(text)) && Number(text) >= 0,
  );
/** Immutable public OpenRouter rates in USD per token. */
export const claudePriceSchema = z.object({
  modelId: z.string(),
  fetchedAt: z.string(),
  prompt: rate,
  completion: rate,
  cacheRead: rate,
  cacheWrite: rate,
});
export const claudeAccountingSchema = z.object({
  sessionId: z.string(),
  subscription: z.boolean(),
  models: z.array(
    claudeModelUsageSchema.extend({ price: claudePriceSchema.nullable() }),
  ),
  costUsd: z.number().finite().nonnegative().nullable(),
});
export type ClaudeTokens = z.infer<typeof claudeTokensSchema>;
export type ClaudeModelUsage = z.infer<typeof claudeModelUsageSchema>;
export type ClaudeUsageObservation = z.infer<typeof claudeObservationSchema>;
export type ClaudePrice = z.infer<typeof claudePriceSchema>;
export type ClaudeAccounting = z.infer<typeof claudeAccountingSchema>;
/** Token and cost projection of steps, iterations or a whole run. */
export interface ClaudeUsageSummary extends ClaudeTokens {
  readonly costUsd: number | null;
  readonly subscription: boolean;
  readonly isIncomplete: boolean;
  readonly hasUnknownPrice: boolean;
}
/** Every attempt has its own identity, including repeated loop iterations. */
export interface ClaudeRunUsage {
  readonly steps: readonly {
    readonly attemptId: string;
    readonly name: string;
    readonly usage: ClaudeUsageSummary;
  }[];
  readonly total: ClaudeUsageSummary;
}

/** Ledger state stores counters and message identities only, never transcript text. */
export const claudeLedgerSchema = z.object({
  settled: z.array(claudeModelUsageSchema),
  messages: z.record(z.string(), claudeModelUsageSchema),
  seen: z.array(z.string()),
});
export type ClaudeLedger = z.infer<typeof claudeLedgerSchema>;

/** Validated read projection, retained by both server and browser run readers. */
export const claudeUsageSummarySchema = claudeTokensSchema.extend({
  costUsd: z.number().finite().nonnegative().nullable(),
  subscription: z.boolean(),
  isIncomplete: z.boolean(),
  hasUnknownPrice: z.boolean(),
});
export const claudeRunUsageSchema = z.object({
  steps: z.array(
    z.object({
      attemptId: z.string(),
      name: z.string(),
      usage: claudeUsageSummarySchema,
    }),
  ),
  total: claudeUsageSummarySchema,
});

export const CLAUDE_TOKEN_FIELDS = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
] as const;

/** Preserves absent measurements while adding known counters. */
export function addClaudeTokens(
  left: ClaudeTokens,
  right: ClaudeTokens,
): ClaudeTokens {
  const add = (first: number | null, second: number | null): number | null =>
    first === null && second === null ? null : (first ?? 0) + (second ?? 0);
  return {
    inputTokens: add(left.inputTokens, right.inputTokens),
    outputTokens: add(left.outputTokens, right.outputTokens),
    cacheReadTokens: add(left.cacheReadTokens, right.cacheReadTokens),
    cacheWriteTokens: add(left.cacheWriteTokens, right.cacheWriteTokens),
  };
}
