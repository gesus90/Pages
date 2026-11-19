import { z } from "zod";

import { antigravityQuotaAccountSchema } from "@/definition/AntigravityQuota";
import { claudeQuotaAccountSchema } from "@/definition/ClaudeQuota";
import { codexQuotaAccountSchema } from "@/definition/CodexQuota";
import { openRouterQuotaAccountSchema } from "@/definition/OpenRouterQuota";
import { zaiQuotaAccountSchema } from "@/definition/ZaiQuota";

import type { AntigravityQuotaAccount } from "@/definition/AntigravityQuota";
import type { ClaudeQuotaAccount } from "@/definition/ClaudeQuota";
import type { CodexQuotaAccount } from "@/definition/CodexQuota";
import type { OpenRouterQuotaAccount } from "@/definition/OpenRouterQuota";
import type { ZaiQuotaAccount } from "@/definition/ZaiQuota";

/** A provider connection card on the Agents page. */
export type QuotaAccount =
  | ClaudeQuotaAccount
  | CodexQuotaAccount
  | AntigravityQuotaAccount
  | OpenRouterQuotaAccount
  | ZaiQuotaAccount;

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
        codexQuotaAccountSchema,
        antigravityQuotaAccountSchema,
        openRouterQuotaAccountSchema,
        zaiQuotaAccountSchema,
      ]),
    )
    .max(500),
  readAt: z.string().min(1).max(40),
});
