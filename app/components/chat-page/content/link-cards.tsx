import { ExternalLink, Globe, Link2, RotateCw, Unlink } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { useChatContent } from "./chat-content-context";
import { CardAction, ContentCard } from "./content-card";

import type { ConversationLink } from "@/definition/ConversationContent";
import type { CardOrigin } from "./card-types";

const BAR_BUTTON_CLASS =
  "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/** The host with its port, as the head of a web card names the page. */
function hostOf(link: ConversationLink): string {
  try {
    return new URL(link.url).host || link.domain;
  } catch {
    return link.domain;
  }
}

/**
 * The address of the frame document of Pages that embeds the page. The chat
 * never frames the foreign address itself; the policy of the page forbids it.
 */
function embedAddress(
  link: ConversationLink,
  conversationId: string | null,
): string {
  const query = new URLSearchParams({ url: link.url });
  if (conversationId !== null) query.set("conversationId", conversationId);
  return `/chat/embed?${query.toString()}`;
}

interface WebViewProps {
  readonly link: ConversationLink;
  /** The stored conversation whose releases apply; `null` without one. */
  readonly conversationId: string | null;
  /** Replaces the fixed height of the card body, to fill a container. */
  readonly className?: string;
}

/**
 * An embedded, usable web page (PAGE-298): a bar with reload, the address and
 * "open in a new tab", and below it the page.
 *
 * @remarks
 * Used as the body of a web card, in the split view and in the overlay. The
 * page keeps its own colors; the frame and the controls follow the theme.
 * Reloading mounts the frame anew, because the document inside belongs to
 * another origin and cannot be reloaded from here.
 */
export function WebView({
  link,
  conversationId,
  className,
}: WebViewProps): React.ReactElement {
  const { t } = useTranslation();
  const [reloadCount, setReloadCount] = useState(0);
  const address = link.title === "" ? link.url : `${link.url} · ${link.title}`;

  return (
    <div className={cn("flex min-w-0 flex-col", className ?? "h-[360px]")}>
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border bg-surface px-2 py-1.5">
        <button
          aria-label={t("chatPage.cards.reload")}
          className={BAR_BUTTON_CLASS}
          onClick={() => setReloadCount((count) => count + 1)}
          title={t("chatPage.cards.reload")}
          type="button"
        >
          <RotateCw aria-hidden="true" className="size-3.5" />
        </button>
        <input
          aria-label={t("chatPage.cards.address")}
          className="h-7 min-w-0 flex-1 truncate rounded-md bg-muted px-2.5 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
          readOnly
          type="text"
          value={address}
        />
        <a
          aria-label={t("chatPage.cards.openInNewTab")}
          className={BAR_BUTTON_CLASS}
          href={link.url}
          rel="noopener noreferrer"
          target="_blank"
          title={t("chatPage.cards.openInNewTab")}
        >
          <ExternalLink aria-hidden="true" className="size-3.5" />
        </a>
      </div>
      <iframe
        key={reloadCount}
        className="min-h-0 w-full flex-1 border-0 bg-surface"
        referrerPolicy="no-referrer"
        src={embedAddress(link, conversationId)}
        title={t("chatPage.cards.embeddedPage", { domain: hostOf(link) })}
      />
    </div>
  );
}

interface LinkCardProps {
  readonly link: ConversationLink;
  readonly cardKey: string;
  readonly origin: CardOrigin;
}

/** A page that may be embedded here: collapsed to its head until asked for. */
function WebCard({ link, cardKey, origin }: LinkCardProps): React.ReactElement {
  const { t } = useTranslation();
  const content = useChatContent();
  const [reloadCount, setReloadCount] = useState(0);
  // Only a release of a member can be taken back here, not Pages itself, a
  // local preview or a domain the administrator released.
  const isReleasedHere = content.releasedDomains.includes(link.domain);

  return (
    <ContentCard
      actions={
        <>
          <CardAction
            icon={RotateCw}
            label={t("chatPage.cards.reload")}
            onClick={() => setReloadCount((count) => count + 1)}
          />
          <CardAction
            href={link.url}
            icon={ExternalLink}
            isNewTab
            label={t("chatPage.cards.newTab")}
          />
          {isReleasedHere ? (
            <CardAction
              icon={Unlink}
              label={t("chatPage.cards.removeRelease")}
              onClick={() => content.setDomainReleased(link.domain, false)}
            />
          ) : null}
        </>
      }
      beside={{ key: cardKey, descriptor: { kind: "web", link }, origin }}
      cardKey={cardKey}
      defaultState="collapsed"
      icon={Globe}
      kindLabel={t("chatPage.cards.kind.web")}
      name={hostOf(link)}
    >
      <WebView
        key={reloadCount}
        conversationId={content.conversationId}
        link={link}
      />
    </ContentCard>
  );
}

/** A page that may not be embedded here: its preview, opened in a new tab. */
function LinkCard({
  link,
}: {
  readonly link: ConversationLink;
}): React.ReactElement {
  const { t } = useTranslation();
  const content = useChatContent();

  return (
    <section
      aria-label={link.title === "" ? link.domain : link.title}
      className="flex w-full max-w-xl min-w-0 flex-col gap-1.5"
      data-link-card={link.domain}
    >
      <a
        className="flex min-h-[72px] overflow-hidden rounded-xl border border-border bg-surface text-foreground shadow-xs hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        href={link.url}
        rel="noopener noreferrer"
        target="_blank"
      >
        {link.imageUrl === null ? null : (
          <img
            alt=""
            className="w-[130px] shrink-0 self-stretch bg-muted object-cover"
            loading="lazy"
            src={link.imageUrl}
          />
        )}
        <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-3.5 py-3">
          <span className="truncate text-xs text-muted-foreground">
            {link.domain}
          </span>
          {link.title === "" ? null : (
            <span className="truncate text-sm font-semibold">{link.title}</span>
          )}
          {link.description === "" ? null : (
            <span className="line-clamp-2 text-[13px] leading-snug text-muted-foreground">
              {link.description}
            </span>
          )}
        </span>
      </a>
      <div className="flex flex-wrap items-center gap-1.5">
        <CardAction
          href={link.url}
          icon={ExternalLink}
          isNewTab
          label={t("chatPage.cards.newTab")}
        />
        {content.canRelease ? (
          <CardAction
            icon={Link2}
            label={t("chatPage.cards.embedHere")}
            onClick={() => content.setDomainReleased(link.domain, true)}
          />
        ) : null}
      </div>
    </section>
  );
}

interface LinkCardsProps {
  /** The URLs that stand alone in a line of the message, in their order. */
  readonly links: readonly ConversationLink[];
  readonly messageId: string;
  readonly origin: CardOrigin;
}

/**
 * The cards of the URLs of one message (PAGE-298), in their order.
 *
 * @remarks
 * A page that may be embedded in this conversation (Pages itself, a local
 * preview or a released domain) becomes a web card that shows the usable
 * page. Every other URL becomes a link card with preview image, domain,
 * title and description that opens a new tab; a member can release its
 * domain for the conversation from there.
 */
export function LinkCards({
  links,
  messageId,
  origin,
}: LinkCardsProps): React.ReactElement | null {
  const content = useChatContent();
  if (links.length === 0) return null;
  return (
    <>
      {links.map((link, index) => {
        const cardKey = `${messageId}:l${index}`;
        return content.isEmbeddable(link) ? (
          <WebCard
            cardKey={cardKey}
            key={cardKey}
            link={link}
            origin={origin}
          />
        ) : (
          <LinkCard key={cardKey} link={link} />
        );
      })}
    </>
  );
}
