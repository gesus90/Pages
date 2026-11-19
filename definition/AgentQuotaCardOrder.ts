import { z } from "zod";

/** Most connections whose position Pages keeps for one account. */
export const QUOTA_CARD_ORDER_MAXIMUM_COUNT = 200;

/** Longest connection ID Pages accepts in a card order. */
const CONNECTION_ID_MAXIMUM_LENGTH = 200;

/**
 * Validates the card order of the Agents page before the server stores it or
 * the browser shows it.
 * @remarks
 * The order lists connection IDs, first card first. It may name connections
 * the person no longer sees; the page ignores those.
 */
export const quotaCardOrderSchema = z.object({
  order: z
    .array(z.string().min(1).max(CONNECTION_ID_MAXIMUM_LENGTH))
    .max(QUOTA_CARD_ORDER_MAXIMUM_COUNT)
    .refine((order) => new Set(order).size === order.length, {
      message: "A connection stands once in the order.",
    }),
});

/** The card order of one account: connection IDs, first card first. */
export type QuotaCardOrder = z.infer<typeof quotaCardOrderSchema>;
