import type { TFunction } from "i18next";
import type { ConversationAttachment } from "@/definition/ConversationContent";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * Whether the file of an attachment is gone: removed by the
 * server, or its time ran out while the page was open.
 * @param attachment - The attachment.
 * @param now - The current moment in milliseconds.
 */
export function isAttachmentExpired(
  attachment: Pick<ConversationAttachment, "expiresAt" | "expiredAt">,
  now: number,
): boolean {
  if (attachment.expiredAt !== undefined) return true;
  return (
    attachment.expiresAt !== undefined &&
    Date.parse(attachment.expiresAt) <= now
  );
}

/**
 * How long Pages still keeps a file of an agent, as the head of a card says
 * it: "noch 2 Tage", in the last 24 hours "noch 5 Std.".
 * @param expiresAt - When the file is removed; `undefined` for a file that stays.
 * @param now - The current moment in milliseconds.
 * @param t - The translation function.
 * @returns The text, or `null` for a file that stays or is gone.
 */
export function retentionLabel(
  expiresAt: string | undefined,
  now: number,
  t: TFunction,
): string | null {
  if (expiresAt === undefined) return null;
  const left = Date.parse(expiresAt) - now;
  if (!Number.isFinite(left) || left <= 0) return null;
  if (left >= DAY)
    return t("chatPage.cards.retention.days", {
      count: Math.floor(left / DAY),
    });
  if (left >= HOUR)
    return t("chatPage.cards.retention.hours", {
      count: Math.floor(left / HOUR),
    });
  return t("chatPage.cards.retention.soon");
}

/**
 * The earliest end among files, for the head of a gallery.
 * @param attachments - The files of the gallery.
 * @returns The earliest `expiresAt`, or `undefined` when none expires.
 */
export function earliestExpiry(
  attachments: readonly Pick<ConversationAttachment, "expiresAt">[],
): string | undefined {
  const moments = attachments
    .map((attachment) => attachment.expiresAt)
    .filter((moment) => moment !== undefined)
    .sort();
  return moments[0];
}

/**
 * The date a file was stored, as the placeholder of an expired file says it.
 * @param attachment - The attachment.
 * @param language - The language of the interface.
 * @returns For example `14.11.2026, 12:03`; empty without a date.
 */
export function storedDate(
  attachment: Pick<ConversationAttachment, "createdAt">,
  language: string,
): string {
  if (attachment.createdAt === undefined) return "";
  return new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(attachment.createdAt));
}
