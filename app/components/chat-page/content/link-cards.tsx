import { ExternalLink, Globe, Link2, Unlink } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { useChatContent } from "./chat-content-context";
import {
  CardAction,
  CardActionDivider,
  CardHead,
  ContentCard,
} from "./content-card";

import type { ConversationLink } from "@/definition/ConversationContent";
import type { CardOrigin, OpenedCard } from "./card-types";

/** The host with its port, as the head of a web card names the page. */
export function hostOf(link: ConversationLink): string {
  try {
    return new URL(link.url).host || link.domain;
  } catch {
    return link.domain;
  }
}

/** The title of a page in the head of its card: its own title, else its host. */
export function linkTitleOf(link: ConversationLink): string {
  return link.title === "" ? hostOf(link) : link.title;
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
  /** Counts "Neu laden" in the head; every change mounts the frame anew. */
  readonly reloadCount?: number;
  /** Replaces the fixed height of the card body, to fill a container. */
  readonly className?: string;
}

/**
 * An embedded, usable web page: the page in the frame document
 * of Pages.
 *
 * @remarks
 * Used as the body of a web card, in the split view and in the overlay. The
 * head of the card carries the address, "Im neuen Tab öffnen" and "Neu
 * laden". The page keeps its own colors. Reloading mounts the
 * frame anew, because the document inside belongs to another origin and
 * cannot be reloaded from here.
 */
export function WebView({
  link,
  conversationId,
  reloadCount = 0,
  className,
}: WebViewProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className={cn("flex min-w-0 flex-col", className ?? "h-[360px]")}>
      <iframe
        key={reloadCount}
        className="min-h-0 w-full flex-1 border-0 bg-surface"
        data-reload={reloadCount}
        referrerPolicy="no-referrer"
        src={embedAddress(link, conversationId)}
        title={t("chatPage.cards.embeddedPage", { domain: hostOf(link) })}
      />
    </div>
  );
}

/** The main action of a link or web card: "Im neuen Tab öffnen" in the accent color. */
export function OpenInNewTabAction({
  link,
}: {
  readonly link: ConversationLink;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <CardAction
      href={link.url}
      icon={ExternalLink}
      isNewTab
      label={t("chatPage.cards.openInNewTab")}
      variant="primary"
    />
  );
}

interface LinkCardProps {
  readonly link: ConversationLink;
  readonly cardKey: string;
  readonly origin: CardOrigin;
}

/**
 * A page that may be embedded here: collapsed to its
 * head until asked for. The head names title and address; the actions are
 * "Im neuen Tab öffnen", "Freigabe entfernen" where the release can be
 * taken back, "Neu laden", "Daneben", "Vollbild" and "Zuklappen".
 */
function WebCard({ link, cardKey, origin }: LinkCardProps): React.ReactElement {
  const { t } = useTranslation();
  const content = useChatContent();
  const [reloadCount, setReloadCount] = useState(0);
  // Only a release of a member can be taken back here, not Pages itself, a
  // local preview or a domain the administrator released.
  const isReleasedHere = content.releasedDomains.includes(link.domain);
  const card: OpenedCard = {
    key: cardKey,
    descriptor: { kind: "web", link },
    origin,
  };

  return (
    <ContentCard
      actions={
        isReleasedHere ? (
          <CardAction
            icon={Unlink}
            label={t("chatPage.cards.removeRelease")}
            onClick={() => content.setDomainReleased(link.domain, false)}
            variant="quiet"
          />
        ) : null
      }
      beside={card}
      cardKey={cardKey}
      defaultState="collapsed"
      icon={Globe}
      kindLabel={t("chatPage.cards.kind.web")}
      meta={link.url}
      name={linkTitleOf(link)}
      onFullscreen={() => content.openOverlay(card)}
      onReload={() => setReloadCount((count) => count + 1)}
      primary={<OpenInNewTabAction link={link} />}
    >
      <WebView
        conversationId={content.conversationId}
        link={link}
        reloadCount={reloadCount}
      />
    </ContentCard>
  );
}

/** Description and preview image of a link card; a click opens the page. */
function LinkPreview({
  link,
}: {
  readonly link: ConversationLink;
}): React.ReactElement | null {
  if (link.description === "" && link.imageUrl === null) return null;
  return (
    <a
      className="flex min-h-[72px] border-t border-border hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      href={link.url}
      rel="noopener noreferrer"
      tabIndex={-1}
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
      {link.description === "" ? null : (
        <span className="line-clamp-3 min-w-0 flex-1 self-center px-3.5 py-3 text-[13px] leading-snug text-muted-foreground">
          {link.description}
        </span>
      )}
    </a>
  );
}

/**
 * A page that may not be embedded here: the shared
 * head with the link icon, the title and below it the domain, then
 * description and preview image. Its main action opens a new tab; a member
 * can release its domain for the conversation with the quiet "In diesem
 * Chat einbetten".
 */
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
      className="w-full max-w-xl min-w-0 overflow-hidden rounded-xl border border-border bg-surface text-foreground shadow-xs"
      data-link-card={link.domain}
    >
      <CardHead
        actions={
          <>
            <OpenInNewTabAction link={link} />
            {content.canRelease ? (
              <>
                <CardActionDivider />
                <CardAction
                  icon={Link2}
                  label={t("chatPage.cards.embedHere")}
                  onClick={() => content.setDomainReleased(link.domain, true)}
                  variant="quiet"
                />
              </>
            ) : null}
          </>
        }
        icon={Link2}
        name={linkTitleOf(link)}
        subtitle={link.domain}
      />
      <LinkPreview link={link} />
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
 * The cards of the URLs of one message, in their order.
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
