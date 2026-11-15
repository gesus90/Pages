import { CornerUpLeft, MessageSquareText, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AttachmentCards } from "./attachment-cards";
import { messageElement } from "./chat-image-viewer";
import { CardAction } from "./content-card";
import { ExpiredAttachment } from "./expired-attachment";
import { textAttachmentKind } from "./message-content";
import { TextAttachmentCard } from "./text-attachment-card";

import type {
  ConversationAttachment,
  ConversationAttachmentReference,
} from "@/definition/ConversationContent";
import type { CardOrigin } from "./card-types";

interface ReferenceCardsProps {
  /** The earlier attachments a message shows again, in their order. */
  readonly references: readonly ConversationAttachmentReference[];
}

/**
 * Scrolls to the message that carries the original and gives it the focus;
 * a message outside the loaded history leaves the view as it is.
 */
function goToMessage(messageId: string): void {
  const element = messageElement(messageId);
  if (!element) return;
  element.scrollIntoView({ block: "center", behavior: "smooth" });
  element.focus({ preventScroll: true });
}

/** "aus einer früheren Nachricht von …" with "Zur Nachricht" above the card. */
function ReferenceHead({
  reference,
}: {
  readonly reference: ConversationAttachmentReference;
}): React.ReactElement {
  const { t } = useTranslation();
  const source =
    reference.senderName === ""
      ? t("chatPage.cards.reference.fromUnknown")
      : t("chatPage.cards.reference.from", { name: reference.senderName });
  return (
    <div
      className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"
      data-reference-head=""
    >
      <CornerUpLeft aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="truncate">{source}</span>
      {reference.state === "deleted" ? null : (
        <CardAction
          icon={MessageSquareText}
          label={t("chatPage.cards.toMessage")}
          onClick={() => goToMessage(reference.sourceMessageId)}
          variant="quiet"
        />
      )}
    </div>
  );
}

/** The placeholder of an original deleted with its message. */
function DeletedReference({
  reference,
}: {
  readonly reference: ConversationAttachmentReference;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <p
      className="flex w-full max-w-lg min-w-0 items-center gap-2.5 rounded-xl border border-dashed border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
      data-reference-deleted=""
      title={t("chatPage.cards.reference.deletedLabel")}
    >
      <Trash2 aria-hidden="true" className="size-4 shrink-0" />
      <span className="truncate font-medium text-foreground">
        {reference.name}
      </span>
      <span className="shrink-0">{t("chatPage.cards.reference.deleted")}</span>
    </p>
  );
}

/** The normal card of the original, as its own message shows it. */
function OriginalCard({
  attachment,
  origin,
}: {
  readonly attachment: ConversationAttachment;
  readonly origin: CardOrigin;
}): React.ReactElement | null {
  if (textAttachmentKind(attachment) !== null)
    return <TextAttachmentCard attachment={attachment} origin={origin} />;
  return <AttachmentCards attachments={[attachment]} origin={origin} />;
}

/** One reference: its head, then the card of the original or its placeholder. */
function ReferenceCard({
  reference,
}: {
  readonly reference: ConversationAttachmentReference;
}): React.ReactElement {
  const { attachment } = reference;
  const origin: CardOrigin = {
    senderName: reference.senderName,
    messageId: reference.sourceMessageId,
    ...(reference.sentAt === undefined ? {} : { createdAt: reference.sentAt }),
  };
  let card: React.ReactElement | null;
  if (reference.state === "deleted" || attachment === undefined)
    card = <DeletedReference reference={reference} />;
  else if (reference.state === "expired")
    card = <ExpiredAttachment attachment={attachment} />;
  else card = <OriginalCard attachment={attachment} origin={origin} />;
  return (
    <div
      className="flex min-w-0 flex-col gap-1.5"
      data-attachment-reference={reference.attachmentId}
      data-reference-state={reference.state}
    >
      <ReferenceHead reference={reference} />
      {card}
    </div>
  );
}

/**
 * The earlier attachments of the chat an agent shows again in its answer
 * (PAGE-386): the normal card of each original in the unified card design,
 * with "aus einer früheren Nachricht von …" and "Zur Nachricht" above it.
 *
 * @remarks
 * No copy exists, so the card loads the original and shows its remaining
 * time; an original that expired shows "abgelaufen", one deleted with its
 * message "gelöscht".
 *
 * @returns The cards, or `null` for a message without references.
 */
export function ReferenceCards({
  references,
}: ReferenceCardsProps): React.ReactElement | null {
  if (references.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-3" data-reference-cards="">
      {references.map((reference, index) => (
        <ReferenceCard
          key={`${reference.attachmentId}:${String(index)}`}
          reference={reference}
        />
      ))}
    </div>
  );
}
