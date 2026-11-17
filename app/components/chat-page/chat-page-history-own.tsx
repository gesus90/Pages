import {
  AppWindow,
  ArrowRight,
  CircleAlert,
  Clock,
  CornerDownRight,
} from "lucide-react";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { ChatPageDecision } from "./chat-page-decision";
import { ChatPageVoice } from "./chat-page-voice";
import { MessageContentView } from "./content/message-content-view";
import { MessageDelete } from "./content/message-delete";
import { MentionMarkdown } from "./mentions/mention-markdown";

import type { LucideIcon } from "lucide-react";
import type {
  ConversationDeliveryState,
  ConversationRecipientDelivery,
} from "@/definition/ConversationRecipientDelivery";
import type { VirtualChatMessage } from "@/definition/VirtualChat";
import type { HistoryLive } from "./chat-page-history";

/** Hides inline markdown images because cards render them below the text. */
export function hideImages(): boolean {
  return false;
}

/**
 * Says that the answer to a message waits: for the answer the
 * agent gives in this chat, or for a free place among the session limits.
 */
function QueueBadge({
  queue,
}: {
  readonly queue: VirtualChatMessage["queue"];
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (queue === undefined) return null;
  return (
    <p
      className="inline-flex items-center gap-1 text-xs text-muted-foreground"
      role="status"
    >
      <Clock aria-hidden="true" className="size-3.5 shrink-0" />
      {t(`chatPage.queue.${queue}`)}
    </p>
  );
}

/** "Eds", "Max’", or "Ed's": the owner of an answer in the page's language. */
function possessive(name: string, language: string): string {
  if (language.startsWith("en")) return `${name}'s`;
  return /[sßxz]$/iu.test(name) ? `${name}’` : `${name}s`;
}

/** How a message sent during an answer reached the agents. */
type MessageDelivery =
  | { readonly kind: "injected"; readonly agentIds: readonly string[] }
  | { readonly kind: "waiting"; readonly agentIds: readonly string[] }
  | { readonly kind: "failed" };

/** What the stream told last wins over what the history was read with. */
function deliveryOf(
  message: VirtualChatMessage,
  live: HistoryLive,
): MessageDelivery | null {
  const streamed = live.deliveries[message.id];
  if (streamed?.delivery === "failed") return { kind: "failed" };
  if (streamed)
    return { kind: streamed.delivery, agentIds: [streamed.agentId] };
  if (message.steeredInto && message.steeredInto.length > 0)
    return { kind: "injected", agentIds: message.steeredInto };
  if (message.queue === "chat") return { kind: "waiting", agentIds: [] };
  return null;
}

/**
 * Says how a message sent during an answer reached the agents:
 * "in Eds Antwort eingeschoben", or "wartet · geht nach Eds Antwort raus".
 */
function DeliveryBadge({
  delivery,
  live,
}: {
  readonly delivery: MessageDelivery;
  readonly live: HistoryLive;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  if (delivery.kind === "failed")
    return (
      <p className="text-xs text-destructive" role="status">
        {t("chatPage.liveAnswer.notDelivered")}
      </p>
    );
  const owner = delivery.agentIds
    .map((id) => possessive(live.nameOf(id), i18n.language))
    .join(` ${t("chatPage.liveAnswer.and")} `);
  const isInjected = delivery.kind === "injected";
  let text = t("chatPage.liveAnswer.waitingAnyone");
  if (owner !== "")
    text = t(
      isInjected
        ? "chatPage.liveAnswer.injected"
        : "chatPage.liveAnswer.waiting",
      { owner },
    );
  return (
    <p
      className={cn(
        "inline-flex items-center gap-1 text-[11px]",
        isInjected ? "text-primary" : "text-muted-foreground",
      )}
      role="status"
    >
      {isInjected ? (
        <CornerDownRight aria-hidden="true" className="size-3.5 shrink-0" />
      ) : (
        <Clock aria-hidden="true" className="size-3.5 shrink-0" />
      )}
      {text}
    </p>
  );
}

/** The symbol and color of each confirmed delivery to one agent. */
const RECIPIENT_DELIVERY_LOOKS: Readonly<
  Record<
    ConversationDeliveryState,
    { readonly icon: LucideIcon; readonly className: string }
  >
> = {
  injected: { icon: CornerDownRight, className: "text-primary" },
  started: { icon: ArrowRight, className: "text-muted-foreground" },
  queued: { icon: Clock, className: "text-muted-foreground" },
  failed: { icon: CircleAlert, className: "text-destructive" },
};

/**
 * The text of one delivery line: "**Ed** · neuer Auftrag", or for a
 * message sent after the answer that still waits, the former
 * "wartet · geht nach Eds Antwort raus".
 */
function RecipientDeliveryText({
  delivery,
  name,
}: {
  readonly delivery: ConversationRecipientDelivery;
  readonly name: string;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  if (delivery.intent === "after" && delivery.state === "queued")
    return (
      <span>
        {t("chatPage.liveAnswer.waiting", {
          owner: possessive(name, i18n.language),
        })}
      </span>
    );
  return (
    <span>
      <strong className="font-semibold">{name}</strong>
      {` · ${t(`chatPage.liveAnswer.delivery.${delivery.state}`)}`}
    </span>
  );
}

/**
 * One line per agent the server confirmed for an own message of a group:
 * taken into the running answer, accepted as a new task, queued, or not
 * delivered. A new task names its acceptance, not a started process.
 */
function RecipientDeliveries({
  deliveries,
  live,
}: {
  readonly deliveries: readonly ConversationRecipientDelivery[];
  readonly live: HistoryLive;
}): React.ReactElement | null {
  if (deliveries.length === 0) return null;
  return (
    <div
      className="flex flex-col items-end gap-[3px]"
      data-recipient-deliveries=""
    >
      {deliveries.map((delivery) => {
        const look = RECIPIENT_DELIVERY_LOOKS[delivery.state];
        const Icon = look.icon;
        return (
          <p
            className={cn(
              "inline-flex items-center gap-[5px] text-[11px] leading-4 whitespace-nowrap",
              look.className,
            )}
            data-recipient-delivery={delivery.state}
            key={delivery.agentId}
            role={delivery.state === "failed" ? "status" : undefined}
          >
            <Icon aria-hidden="true" className="size-3.5 shrink-0" />
            <RecipientDeliveryText
              delivery={delivery}
              name={live.nameOf(delivery.agentId)}
            />
          </p>
        );
      })}
    </div>
  );
}

/** Marks a message a person sent from a preview of the chat. */
export function PreviewSentBadge(): React.ReactElement {
  const { t } = useTranslation();
  return (
    <p
      className="inline-flex items-center gap-1 text-xs text-muted-foreground"
      data-from-preview=""
    >
      <AppWindow aria-hidden="true" className="size-3.5 shrink-0" />
      {t("chatPage.preview.sentFromPreview")}
    </p>
  );
}

/**
 * The corners of an own bubble. A delivery frame takes the same corners,
 * so its ring or outline runs evenly around the bubble.
 */
const OWN_BUBBLE_RADIUS = "rounded-[14px] rounded-br-[4px]";

/**
 * The frame of an own message sent during an answer, around its bubble
 * only: orange when it went in, dashed while it waits.
 */
const DELIVERY_FRAMES: Readonly<Record<MessageDelivery["kind"], string>> = {
  injected: `${OWN_BUBBLE_RADIUS} ring-2 ring-primary ring-offset-2 ring-offset-background`,
  waiting: `${OWN_BUBBLE_RADIUS} outline-dashed outline-2 outline-offset-2 outline-border`,
  failed: "",
};

const OWN_BUBBLE = `max-w-[62%] min-w-0 ${OWN_BUBBLE_RADIUS} bg-primary px-4 py-2.5 text-primary-foreground`;

/** How an own message shows its delivery: the frame around its bubble and its `data-delivery`. */
interface OwnDeliveryLook {
  readonly frame: string;
  readonly kind: string | undefined;
}

/**
 * The frame of a message whose deliveries the server confirmed per agent:
 * the ring only when every agent took it into its running answer, the dashed
 * outline only while every agent it was sent "after" still answers, and no
 * frame for mixed deliveries, whose lines say it.
 */
function recipientLook(
  deliveries: readonly ConversationRecipientDelivery[],
): OwnDeliveryLook {
  const [first] = deliveries;
  if (!first) return { frame: "", kind: undefined };
  const isUniform = deliveries.every((entry) => entry.state === first.state);
  const kind = isUniform ? first.state : "mixed";
  if (isUniform && first.state === "injected")
    return { frame: DELIVERY_FRAMES.injected, kind };
  const isWaitingAfter = deliveries.every(
    (entry) => entry.intent === "after" && entry.state === "queued",
  );
  return { frame: isWaitingAfter ? DELIVERY_FRAMES.waiting : "", kind };
}

/** The confirmed deliveries per agent win; without them the former badges stay. */
function ownDeliveryLook(
  message: VirtualChatMessage,
  delivery: MessageDelivery | null,
): OwnDeliveryLook {
  if (message.deliveries !== undefined)
    return recipientLook(message.deliveries);
  return {
    frame: delivery ? DELIVERY_FRAMES[delivery.kind] : "",
    kind: delivery?.kind,
  };
}

/** The badges under an own message: per agent when confirmed, otherwise the former ones. */
function OwnDeliveryBadges({
  message,
  delivery,
  live,
}: {
  readonly message: VirtualChatMessage;
  readonly delivery: MessageDelivery | null;
  readonly live: HistoryLive;
}): React.ReactElement {
  if (message.deliveries !== undefined)
    return <RecipientDeliveries deliveries={message.deliveries} live={live} />;
  if (delivery) return <DeliveryBadge delivery={delivery} live={live} />;
  return <QueueBadge queue={message.queue} />;
}

/**
 * Puts the frame of a delivery around one bubble: the frame takes the
 * width of the bubble and stands at the right, the bubble fills it.
 */
function FramedBubble({
  frame,
  isWide = false,
  children,
}: {
  readonly frame: string;
  /** A voice message, which may take the whole width of the history. */
  readonly isWide?: boolean;
  readonly children: React.ReactNode;
}): React.ReactElement {
  if (frame === "") return <>{children}</>;
  return (
    <div
      className={cn(
        "w-fit min-w-0 self-end",
        isWide ? "max-w-full" : "max-w-[62%]",
        frame,
      )}
      data-delivery-frame=""
    >
      {children}
    </div>
  );
}

/** One own message: its text in primary bubbles, its cards between and below. */
function OwnMessage({
  message,
  live,
}: {
  readonly message: VirtualChatMessage;
  readonly live: HistoryLive;
}): React.ReactElement {
  const { t } = useTranslation();
  // Confirmed deliveries per agent replace what the stream told about the message.
  const delivery =
    message.deliveries === undefined ? deliveryOf(message, live) : null;
  const { frame, kind } = ownDeliveryLook(message, delivery);
  return (
    <article
      aria-label={t("chatPage.you")}
      className="group/message flex w-full min-w-0 flex-col items-end gap-2 rounded-lg outline-none transition-shadow data-[message-focus=true]:ring-2 data-[message-focus=true]:ring-primary data-[message-focus=true]:ring-offset-4"
      data-chat-message={message.id}
      data-message-id={message.id}
      data-delivery={kind}
      tabIndex={-1}
    >
      <div className="flex w-full min-w-0 flex-col items-end gap-2">
        {message.voice ? (
          <FramedBubble frame={frame} isWide>
            <ChatPageVoice
              senderName={t("chatPage.cards.you")}
              text={message.content}
              voice={message.voice}
            />
          </FramedBubble>
        ) : (
          <MessageContentView
            message={message}
            origin={{
              senderName: t("chatPage.cards.you"),
              createdAt: message.createdAt,
            }}
            renderText={(text) => (
              <FramedBubble frame={frame}>
                <MentionMarkdown
                  className={cn(
                    OWN_BUBBLE,
                    frame !== "" && "max-w-full",
                    "text-[15px]",
                  )}
                  isDisplayableImage={hideImages}
                  source={text}
                />
              </FramedBubble>
            )}
          />
        )}
      </div>
      {message.isFromPreview === true ? <PreviewSentBadge /> : null}
      <OwnDeliveryBadges message={message} delivery={delivery} live={live} />
      {message.canDelete === true ? (
        <MessageDelete messageId={message.id} />
      ) : null}
    </article>
  );
}

/** The person's own messages at the right, in primary bubbles. */
export function OwnRun({
  messages,
  live,
}: {
  readonly messages: readonly VirtualChatMessage[];
  readonly live: HistoryLive;
}): React.ReactElement {
  return (
    <div className="flex flex-col items-end gap-2">
      {messages.map((message) => (
        <Fragment key={message.id}>
          <OwnMessage message={message} live={live} />
          {message.decision ? (
            <ChatPageDecision decision={message.decision} />
          ) : null}
        </Fragment>
      ))}
    </div>
  );
}
