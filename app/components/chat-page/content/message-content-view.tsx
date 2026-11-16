import { useMemo } from "react";

import { AttachmentCards } from "./attachment-cards";
import { LinkCards } from "./link-cards";
import { parseMessageContent, textAttachmentKind } from "./message-content";
import { PreviewCard } from "./preview-card";
import { previewFileName, previewKindOf } from "./preview-kinds";
import { ReferenceCards } from "./reference-cards";
import { CodeCard, DiffCard, MarkdownCard } from "./text-cards";
import { TextAttachmentCard } from "./text-attachment-card";

import type {
  ConversationAttachment,
  ConversationAttachmentReference,
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
  /** Archive download address supplied for agent chat messages. */
  readonly archiveUrl?: string;
  /** What the server knows of the URLs that stand alone in a line. */
  readonly links?: readonly ConversationLink[];
  /** Earlier attachments of the chat an agent shows again. */
  readonly references?: readonly ConversationAttachmentReference[];
}

interface MessageContentViewProps {
  readonly message: MessageContentSource;
  readonly origin: CardOrigin;
  /**
   * Renders a passage of plain text, as the surrounding chat shows text.
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

type CodePart = Extract<MessagePart, { readonly kind: "code" }>;

/** A code block: a preview for HTML, SVG, Mermaid, JSON and CSV, else a code card. */
function CodePartCard({
  part,
  cardKey,
  origin,
}: {
  readonly part: CodePart;
  readonly cardKey: string;
  readonly origin: CardOrigin;
}): React.ReactElement {
  const kind = previewKindOf(part.languageHint);
  const isDetected = part.isDetected === true;
  if (kind === null)
    return (
      <CodeCard
        cardKey={cardKey}
        isDetected={isDetected}
        languageHint={part.languageHint}
        name={part.name}
        origin={origin}
        text={{ source: part.source }}
      />
    );
  const file = {
    name: previewFileName(part.name, kind),
    languageHint: part.languageHint,
    source: part.source,
  };
  return (
    <PreviewCard
      cardKey={cardKey}
      files={[file]}
      isDetected={isDetected}
      kind={kind}
      name={part.name}
      origin={origin}
    />
  );
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
      return <CodePartCard cardKey={cardKey} origin={origin} part={part} />;
    case "preview":
      return (
        <PreviewCard
          cardKey={cardKey}
          files={part.files}
          isDetected={part.isDetected}
          kind="html"
          name=""
          origin={origin}
        />
      );
    case "diff":
      return <DiffCard cardKey={cardKey} name="" origin={origin} text={text} />;
    case "markdown":
      return (
        <MarkdownCard
          cardKey={cardKey}
          isDetected={part.isDetected === true}
          name=""
          origin={origin}
          text={text}
        />
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

/**
 * The content of one chat message: its text as the chat shows
 * text, and in between and below it the cards.
 * @remarks
 * Fenced code, ` ```diff ` blocks, ` ```markdown ` blocks and a URL alone
 * in a line become cards at their place in the text. HTML, SVG, Mermaid,
 * JSON and CSV blocks become previews; an HTML block takes the CSS and
 * JavaScript blocks of the message into one preview. Attachments follow
 * below: text files as code, diff or Markdown cards, everything else by its
 * MIME type. Earlier attachments an agent shows again follow last, each as
 * the card of its original. The component knows nothing of the page around it, so the Pica
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
  // A message on its way has no stored ID yet, so it offers no archive.
  const mediaOrigin: CardOrigin = message.id.startsWith("pending")
    ? origin
    : {
        ...origin,
        messageId: message.id,
        ...(message.archiveUrl === undefined
          ? {}
          : { archiveUrl: message.archiveUrl }),
      };
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
      <AttachmentCards attachments={media} origin={mediaOrigin} />
      <ReferenceCards references={message.references ?? []} />
    </>
  );
}
