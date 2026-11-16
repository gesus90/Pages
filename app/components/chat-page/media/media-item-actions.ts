import type { ConversationMediaFile } from "@/definition/ConversationMediaOverview";

/** What every entry of "Medien & Dateien" can do and needs to know. */
export interface MediaItemActions {
  readonly selected: ReadonlySet<string>;
  toggleSelected(attachmentId: string): void;
  /** Opens a file in its view: image viewer, video full screen, or large in the panel. */
  open(file: ConversationMediaFile): void;
  /** Goes to the message in the history. */
  toMessage(messageId: string): void;
  senderName(senderId: string): string;
  /** The current moment in milliseconds; `null` before the page knows it. */
  readonly now: number | null;
}

/**
 * The date and time a message was sent, as the entries name it.
 * @param sentAt - The ISO moment.
 * @param language - The language of the interface.
 */
export function formatSentAt(sentAt: string, language: string): string {
  const moment = new Date(sentAt);
  if (Number.isNaN(moment.getTime())) return "";
  return new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(moment);
}
