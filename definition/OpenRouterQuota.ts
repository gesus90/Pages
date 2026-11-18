import { z } from "zod";

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

const readingTime = z.iso.datetime();

/** The two independent readings of a connection, gated by their respective permissions. */
export const openRouterQuotaAccountSchema = z.object({
  provider: z.literal("openrouter"),
  connectionId: z.string().min(1).max(200),
  name: z.string().max(400),
  key: z.object({
    status: z.enum(["stored", "reported", "failed", "invalid_key"]),
    reading: openRouterUsageSchema.extend({ at: readingTime }).nullable(),
  }),
  credits: z
    .object({
      status: z.enum([
        "stored",
        "reported",
        "failed",
        "invalid_key",
        "missing_key",
        "unknown",
      ]),
      reading: openRouterCreditsSchema
        .extend({
          remaining: z.number().finite().nonnegative(),
          at: readingTime,
        })
        .nullable(),
    })
    .optional(),
});

export type OpenRouterQuotaAccount = z.infer<
  typeof openRouterQuotaAccountSchema
>;
