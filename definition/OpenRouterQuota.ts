import { z } from "zod";

import { executionLocationSchema } from "@/definition/ExecutionLocation";

import type { ExecutionLocation } from "@/definition/ExecutionLocation";

/** USD amounts and reset rhythm reported for an OpenRouter API key. */
export const openRouterUsageSchema = z.object({
  usage: z.number().finite().nonnegative().nullable(),
  limit: z.number().finite().nonnegative().nullable().optional(),
  remaining: z.number().finite().nonnegative().nullable(),
  reset: z.enum(["daily", "weekly", "monthly"]).nullable(),
});

export type OpenRouterUsage = z.infer<typeof openRouterUsageSchema>;

/** Purchased and spent USD credits from the same provider response. */
export const openRouterCreditsSchema = z.object({
  purchased: z.number().finite().nonnegative(),
  used: z.number().finite().nonnegative(),
});

export type OpenRouterCredits = z.infer<typeof openRouterCreditsSchema>;

const accountBalanceSchema = z.object({ mode: z.literal("account") });
const manualBalanceSchema = z.object({
  mode: z.literal("manual"),
  startAmount: z.number().finite().nonnegative(),
});

/** The balance display a connection administrator can choose for a card. */
export const openRouterBalanceDisplaySchema = z.discriminatedUnion("mode", [
  accountBalanceSchema,
  manualBalanceSchema,
]);

export type OpenRouterBalanceDisplay = z.infer<
  typeof openRouterBalanceDisplaySchema
>;

const readingTime = z.iso.datetime();

/**
 * Where the provider was asked for a reading, kept beside the reading itself.
 * @remarks
 * Only a reading the Pages service obtained carries it; a card without a
 * reading, and one stored before the place was kept, names none and proves
 * no location.
 */
const retrievalShape = {
  executionLocation: executionLocationSchema.optional(),
};

const creditStatusSchema = z.enum([
  "stored",
  "reported",
  "failed",
  "invalid_key",
  "missing_key",
  "unknown",
]);
const creditBalanceReadingSchema = z.object({
  remaining: z.number().finite().nonnegative(),
  at: readingTime,
});

/** The two independent readings of a connection, gated by their respective permissions. */
export const openRouterQuotaAccountSchema = z.object({
  provider: z.literal("openrouter"),
  connectionId: z.string().min(1).max(200),
  name: z.string().max(400),
  key: z.object({
    status: z.enum(["stored", "reported", "failed", "invalid_key"]),
    reading: openRouterUsageSchema.extend({ at: readingTime }).nullable(),
    ...retrievalShape,
  }),
  credits: z
    .discriminatedUnion("mode", [
      accountBalanceSchema.extend({
        status: creditStatusSchema,
        reading: openRouterCreditsSchema
          .extend(creditBalanceReadingSchema.shape)
          .nullable(),
        ...retrievalShape,
      }),
      manualBalanceSchema.extend({
        status: z.union([creditStatusSchema, z.literal("baseline_missing")]),
        reading: creditBalanceReadingSchema.nullable(),
        ...retrievalShape,
      }),
    ])
    .optional(),
});

export type OpenRouterQuotaAccount = z.infer<
  typeof openRouterQuotaAccountSchema
>;

/**
 * The place the card's readings were retrieved at.
 * @param account - The card as the server answered it.
 * @returns The place a reading of the key or of the credits names, or `null`
 * when the card holds no reading that names one.
 * @remarks
 * The place belongs to the retrieval alone. The key, the account type and
 * the provider never decide it.
 */
export function openRouterExecutionLocation(
  account: OpenRouterQuotaAccount,
): ExecutionLocation | null {
  return (
    account.key.executionLocation ?? account.credits?.executionLocation ?? null
  );
}
