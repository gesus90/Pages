import { z } from "zod";

import { antigravityQuotaAccountSchema } from "@/definition/AntigravityQuota";
import { claudeQuotaAccountSchema } from "@/definition/ClaudeQuota";

import type { AntigravityQuotaAccount } from "@/definition/AntigravityQuota";
import type { ClaudeQuotaAccount } from "@/definition/ClaudeQuota";

/** A card of the Agents page: the account of a Claude or an Antigravity connection. */
export type QuotaAccount = ClaudeQuotaAccount | AntigravityQuotaAccount;

/**
 * What one query of the Agents page answers.
 * @remarks
 * The answer to the query of a single card holds that card, or no account
 * when the person may not use the connection (any more).
 */
export interface QuotaSnapshot {
  readonly accounts: readonly QuotaAccount[];
  /**
   * Server time at which the stored figures were read. A page keeps the
   * answer with the later time when two answers cross.
   */
  readonly readAt: string;
}

/** Validates a quota answer before the browser shows it. */
export const quotaSnapshotSchema = z.object({
  accounts: z
    .array(
      z.discriminatedUnion("provider", [
        claudeQuotaAccountSchema,
        antigravityQuotaAccountSchema,
      ]),
    )
    .max(500),
  readAt: z.string().min(1).max(40),
});
