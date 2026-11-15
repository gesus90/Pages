import { z } from "zod";

const tokenCount = z.number().int().nonnegative().safe().nullable();

/** Native Codex counters include cache in input and reasoning in output. */
export const codexTokenCountsSchema = z.object({
  inputTokens: tokenCount,
  cacheReadTokens: tokenCount,
  outputTokens: tokenCount,
  reasoningTokens: tokenCount,
});
export type CodexTokenCounts = z.infer<typeof codexTokenCountsSchema>;

/** A native thread total, never the context occupancy or the last model call. */
export const codexThreadReportSchema = z.object({
  threadId: z.string().regex(/^[a-zA-Z0-9-]{1,100}$/u),
  totals: codexTokenCountsSchema,
  /** Prompt delta used only to reconcile a final ACP response with delayed native totals. */
  promptTokens: codexTokenCountsSchema.optional(),
  baseline: z.boolean(),
  model: z.string().min(1).max(200),
});
export type CodexThreadReport = z.infer<typeof codexThreadReportSchema>;

/** Prices in USD per token, frozen with the first calculation of an attempt. */
export const codexPriceSchema = z.object({
  modelId: z.string(),
  catalogAt: z.string(),
  prompt: z.number().finite().nonnegative(),
  completion: z.number().finite().nonnegative(),
  cache: z.number().finite().nonnegative(),
  reasoning: z.number().finite().nonnegative(),
});
export type CodexPrice = z.infer<typeof codexPriceSchema>;

/** Calculated equivalent cost; Codex connections use the managed ChatGPT login. */
export const codexAccountingSchema = z.object({
  costUsd: z.number().finite().nonnegative().nullable(),
  isSubscription: z.boolean(),
  price: codexPriceSchema.nullable(),
});
export type CodexAccounting = z.infer<typeof codexAccountingSchema>;

/** Native input kept in the durable local-owner outbox until atomic projection. */
export const codexUsageSourceSchema = z.object({
  connectionId: z.string(),
  agentId: z.string(),
  report: codexThreadReportSchema.nullable(),
});
export type CodexUsageSource = z.infer<typeof codexUsageSourceSchema>;

/** Step and run projections share exactly the same counters and cost sum. */
export interface CodexUsageSummary extends CodexTokenCounts {
  readonly costUsd: number | null;
  readonly isSubscription: boolean;
  readonly isPartial: boolean;
  readonly isPriceUnknown: boolean;
}

export interface CodexRunUsage {
  readonly total: CodexUsageSummary;
  readonly steps: readonly {
    readonly stepId: string;
    readonly usage: CodexUsageSummary;
  }[];
}

const codexUsageSummarySchema = codexTokenCountsSchema.extend({
  costUsd: z.number().finite().nonnegative().nullable(),
  isSubscription: z.boolean(),
  isPartial: z.boolean(),
  isPriceUnknown: z.boolean(),
});

/** Validates the public projection before the live run panel renders it. */
export const codexRunUsageSchema = z.object({
  total: codexUsageSummarySchema,
  steps: z.array(
    z.object({ stepId: z.string(), usage: codexUsageSummarySchema }),
  ),
});
