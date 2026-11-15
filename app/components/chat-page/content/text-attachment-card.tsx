import { ExpiredAttachment } from "./expired-attachment";
import { textAttachmentKind } from "./message-content";
import { CodeCard, DiffCard, MarkdownCard } from "./text-cards";

import type { ConversationAttachment } from "@/definition/ConversationContent";
import type { CardOrigin } from "./card-types";

/** An attachment whose text the chat renders: code, a diff or Markdown. */
export function TextAttachmentCard({
  attachment,
  origin,
}: {
  readonly attachment: ConversationAttachment;
  readonly origin: CardOrigin;
}): React.ReactElement | null {
  const kind = textAttachmentKind(attachment);
  // A file of an agent whose 72 hours ended keeps only its placeholder (PAGE-382).
  if (attachment.expiredAt !== undefined)
    return <ExpiredAttachment attachment={attachment} />;
  const shared = {
    cardKey: `att:${attachment.id}`,
    name: attachment.name,
    origin,
    text: { source: null, sourceUrl: attachment.url },
  };
  if (kind === "diff") return <DiffCard {...shared} />;
  if (kind === "markdown") return <MarkdownCard {...shared} />;
  return kind === "code" ? (
    <CodeCard {...shared} languageHint={attachment.name} />
  ) : null;
}
