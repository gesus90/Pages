import { useMemo } from "react";

import { AttachmentCards } from "./attachment-cards";
import { LinkCards } from "./link-cards";
import { parseMessageContent, textAttachmentKind } from "./message-content";
import { CodeCard, DiffCard, MarkdownCard } from "./text-cards";

import type {
  ConversationAttachment,
  ConversationLink,
} from "@/definition/ConversationContent";
import type { CardOrigin } from "./card-types";
import type { MessagePart } from "./message-content";

/** Hosts of local previews, which embed without a release. */
const LOCAL_HOSTS: readonly string[] = ["localhost", "127.0.0.1"];

/** The message whose content is shown. */
export interface MessageContentSource {
  readonly id: string;
  /** Markdown text of the message. */
  readonly content: string;
  readonly attachments?: readonly ConversationAttachment[];
  /** What the server knows of the URLs that stand alone in a line. */
  readonly links?: readonly ConversationLink[];
}

interface MessageContentViewProps {
  readonly message: MessageContentSource;
  readonly origin: CardOrigin;
  /**
   * Renders a passage of plain text, as the surrounding chat shows text.
   *
   * @param text - The Markdown of the passage.
   * @param isFirst - Whether nothing of the message stands before it.
   */
  readonly renderText: (text: string, isFirst: boolean) => React.ReactNode;
}

/** A link the server told nothing about, as in a chat session with an agent. */
function plainLink(url: string): ConversationLink {
  const { hostname } = new URL(url);
  return {
    url,
    domain: hostname,
    title: "",
    description: "",
    imageUrl: null,
    embeddable: LOCAL_HOSTS.includes(hostname),
  };
}

interface PartViewProps {
  readonly part: Exclude<MessagePart, { readonly kind: "text" }>;
  readonly cardKey: string;
  readonly origin: CardOrigin;
  readonly links: readonly ConversationLink[];
}

/** One card of the text of a message. */
function PartCard({
  part,
  cardKey,
  origin,
  links,
}: PartViewProps): React.ReactElement | null {
  const text = { source: "source" in part ? part.source : null };
  switch (part.kind) {
    case "code":
      return (
        <CodeCard
          cardKey={cardKey}
          languageHint={part.languageHint}
          name={part.name}
          origin={origin}
          text={text}
        />
      );
    case "diff":
      return <DiffCard cardKey={cardKey} name="" origin={origin} text={text} />;
    case "markdown":
      return (
        <MarkdownCard cardKey={cardKey} name="" origin={origin} text={text} />
      );
    case "link":
      return (
        <LinkCards
          links={[
            links.find((link) => link.url === part.url) ?? plainLink(part.url),
          ]}
          messageId={cardKey}
          origin={origin}
        />
      );
  }
}

/** An attachment whose text the chat renders: code, a diff or Markdown. */
function TextAttachmentCard({
  attachment,
  origin,
}: {
  readonly attachment: ConversationAttachment;
  readonly origin: CardOrigin;
}): React.ReactElement | null {
  const kind = textAttachmentKind(attachment);
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

/**
 * The content of one chat message (PAGE-298): its text as the chat shows
 * text, and in between and below it the cards.
 *
 * @remarks
 * Fenced code, ` ```diff ` blocks, ` ```markdown ` blocks and a URL alone
 * in a line become cards at their place in the text. Attachments follow
 * below: text files as code, diff or Markdown cards, everything else by its
 * MIME type. The component knows nothing of the page around it, so the Pica
 * panel and groups render messages with it alike.
 */
export function MessageContentView({
  message,
  origin,
  renderText,
}: MessageContentViewProps): React.ReactElement {
  const parts = useMemo(
    () => parseMessageContent(message.content),
    [message.content],
  );
  const attachments = message.attachments ?? [];
  const media = attachments.filter(
    (attachment) => textAttachmentKind(attachment) === null,
  );
  return (
    <>
      {parts.map((part, index) =>
        part.kind === "text" ? (
          <div key={index} className="contents" data-message-text="">
            {renderText(part.text, index === 0)}
          </div>
        ) : (
          <PartCard
            key={index}
            cardKey={`${message.id}:${String(index)}`}
            links={message.links ?? []}
            origin={origin}
            part={part}
          />
        ),
      )}
      {attachments
        .filter((attachment) => textAttachmentKind(attachment) !== null)
        .map((attachment) => (
          <TextAttachmentCard
            key={attachment.id}
            attachment={attachment}
            origin={origin}
          />
        ))}
      <AttachmentCards attachments={media} origin={origin} />
    </>
  );
}
