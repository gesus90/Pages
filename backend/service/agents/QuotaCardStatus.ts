import type { ClaudeQuotaStatus } from "@/definition/ClaudeQuota";
import type { QuotaProbeOutcome } from "./ProviderQuotaProbe";

/**
 * What the status line of a card says about the last query.
 * @param outcome - The outcome of this query of the connection, `null` when
 * the answer comes from the stored figures without a query.
 * @param reported - The time of the provider's last answer, `null` when
 * there never was one, and whether the stored figures hold a window that is
 * still ahead of its reset.
 * @returns The status of the card.
 * @remarks
 * After an answer the time is that of the answer, which the probe stored as
 * the newest reading; at least one window with a value means "reported",
 * none means "no windows", never a failure. Without a query the card is
 * "stored" with the time of the last answer.
 */
export function quotaCardStatus(
  outcome: QuotaProbeOutcome | null,
  reported: { readonly at: string | null; readonly hasWindows: boolean },
): ClaudeQuotaStatus {
  if (outcome === null) return { kind: "stored", at: reported.at };
  if (outcome.status === "busy") return { kind: "skipped" };
  if (outcome.status === "signed_out") return { kind: "signed_out" };
  if (outcome.status === "failed" || reported.at === null)
    return { kind: "failed", lastSuccessAt: reported.at };
  return reported.hasWindows
    ? { kind: "reported", at: reported.at }
    : { kind: "no_windows", at: reported.at };
}
