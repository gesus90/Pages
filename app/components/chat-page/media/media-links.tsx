import { ExternalLink, Globe, MessageSquareText } from "lucide-react";
import { useTranslation } from "react-i18next";

import { CardAction } from "../content/content-card";
import { formatSentAt } from "./media-item-actions";

import type { ConversationMediaLink } from "@/definition/ConversationMediaOverview";
import type { MediaItemActions } from "./media-item-actions";

/** One link: domain, title and sender, opened in a new tab. */
function MediaLinkRow({
  link,
  actions,
}: {
  readonly link: ConversationMediaLink;
  readonly actions: Pick<MediaItemActions, "toMessage" | "senderName">;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const origin = [
    actions.senderName(link.senderId),
    formatSentAt(link.sentAt, i18n.language),
  ]
    .filter((part) => part !== "")
    .join(" · ");
  return (
    <li
      className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 rounded-xl border border-border bg-surface px-3 py-2 shadow-xs"
      data-media-link={link.url}
    >
      <span className="flex size-8 items-center justify-center overflow-hidden rounded-lg bg-primary-subtle text-primary">
        {link.imageUrl === null ? (
          <Globe aria-hidden="true" className="size-4" />
        ) : (
          <img
            alt=""
            className="size-full object-cover"
            loading="lazy"
            src={link.imageUrl}
          />
        )}
      </span>
      <p className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-xs font-medium text-primary">
          {link.domain}
        </span>
        <a
          className="truncate text-[13px] font-semibold text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-primary"
          href={link.url}
          rel="noopener noreferrer"
          target="_blank"
          title={link.url}
        >
          {link.title === "" ? link.url : link.title}
        </a>
        <span className="truncate text-xs text-muted-foreground">{origin}</span>
      </p>
      <span className="flex items-center gap-1">
        <CardAction
          icon={MessageSquareText}
          isIconOnly
          label={t("chatPage.cards.toMessage")}
          onClick={() => actions.toMessage(link.messageId)}
          variant="quiet"
        />
        <CardAction
          href={link.url}
          icon={ExternalLink}
          isIconOnly
          isNewTab
          label={t("chatPage.cards.newTab")}
          variant="quiet"
        />
      </span>
    </li>
  );
}

/** The links of the chat as a list with domain, title and sender. */
export function MediaLinks({
  links,
  actions,
}: {
  readonly links: readonly ConversationMediaLink[];
  readonly actions: Pick<MediaItemActions, "toMessage" | "senderName">;
}): React.ReactElement {
  return (
    <ul className="flex flex-col gap-2 p-3">
      {links.map((link) => (
        <MediaLinkRow
          key={`${link.messageId}:${link.url}`}
          actions={actions}
          link={link}
        />
      ))}
    </ul>
  );
}
