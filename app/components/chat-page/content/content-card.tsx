import {
  ChevronDown,
  ChevronUp,
  Download,
  Maximize2,
  PanelRight,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { useChatContent } from "./chat-content-context";

import type { LucideIcon } from "lucide-react";
import type { ChatCardState } from "@/definition/ConversationContent";
import type { OpenedCard } from "./card-types";

/** Light cards in the chat, dark ones in the image viewer (PAGE-382). */
export type CardTone = "light" | "dark";

/**
 * How an action looks (PAGE-382): `primary` is the one main action in the
 * accent color, such as "Herunterladen"; `quiet` an icon button such as
 * "Daneben", "Vollbild" or "Schließen"; `default` a small framed action of a
 * kind, such as "Kopieren".
 */
export type CardActionVariant = "primary" | "quiet" | "default";

const BASE_CLASS =
  "inline-flex h-7 shrink-0 items-center gap-1 rounded-md text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

const VARIANT_CLASSES: Readonly<
  Record<CardTone, Readonly<Record<CardActionVariant, string>>>
> = {
  light: {
    primary:
      "bg-primary px-2.5 text-primary-foreground hover:bg-primary-hover",
    quiet:
      "justify-center px-1.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground",
    default:
      "border border-border bg-surface px-2 text-foreground hover:bg-surface-hover",
  },
  dark: {
    primary:
      "bg-primary px-2.5 text-primary-foreground hover:bg-primary-hover",
    quiet:
      "justify-center px-1.5 text-viewer-foreground hover:bg-viewer-control-hover",
    default:
      "border border-viewer-edge bg-viewer-control px-2 text-viewer-foreground hover:bg-viewer-control-hover",
  },
};

interface CardActionProps {
  readonly label: string;
  readonly icon?: LucideIcon;
  /** Shows the icon alone; the label stays the accessible name. */
  readonly isIconOnly?: boolean;
  readonly isActive?: boolean;
  readonly onClick?: () => void;
  /** Makes the action a link, for a download or a new tab. */
  readonly href?: string;
  /** With `href`: opens a new tab instead of loading the file. */
  readonly isNewTab?: boolean;
  readonly variant?: CardActionVariant;
  readonly tone?: CardTone;
}

/** One small action in the head of a content card, the split view or a viewer. */
export function CardAction({
  label,
  icon: Icon,
  isIconOnly = false,
  isActive = false,
  onClick,
  href,
  isNewTab = false,
  variant = "default",
  tone = "light",
}: CardActionProps): React.ReactElement {
  const className = cn(
    BASE_CLASS,
    VARIANT_CLASSES[tone][variant],
    isIconOnly && variant !== "primary" && "w-7 px-0",
    // An active view lights its button in the accent color.
    isActive && "bg-primary-subtle text-primary hover:bg-primary-subtle",
  );
  const content = (
    <>
      {Icon ? <Icon aria-hidden="true" className="size-3.5" /> : null}
      {isIconOnly ? <span className="sr-only">{label}</span> : label}
    </>
  );
  const title = isIconOnly ? label : undefined;
  if (href === undefined)
    return (
      <button
        aria-pressed={isActive ? true : undefined}
        className={className}
        onClick={onClick}
        title={title}
        type="button"
      >
        {content}
      </button>
    );
  return isNewTab ? (
    <a
      className={className}
      href={href}
      rel="noopener noreferrer"
      target="_blank"
      title={title}
    >
      {content}
    </a>
  ) : (
    <a className={className} download="" href={href} title={title}>
      {content}
    </a>
  );
}

/** The thin line between the main action and the quiet ones. */
export function CardActionDivider({
  tone = "light",
}: {
  readonly tone?: CardTone;
}): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "mx-0.5 h-5 w-px shrink-0",
        tone === "dark" ? "bg-viewer-edge" : "bg-border",
      )}
    />
  );
}

/** The download of a card: its address and, for a gallery, its label. */
export interface CardDownload {
  readonly href: string;
  /** "Alle herunterladen" for a gallery; "Herunterladen" by default. */
  readonly label?: string;
}

/** The main action "Herunterladen" in the accent color. */
export function CardDownloadAction({
  download,
  tone = "light",
  isIconOnly = false,
}: {
  readonly download: CardDownload;
  readonly tone?: CardTone;
  readonly isIconOnly?: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <CardAction
      href={download.href}
      icon={Download}
      isIconOnly={isIconOnly}
      label={download.label ?? t("chatPage.cards.download")}
      tone={tone}
      variant="primary"
    />
  );
}

interface CardHeadProps {
  readonly icon: LucideIcon;
  readonly name: string;
  /** Kind · size or count · remaining time, in one small line. */
  readonly subtitle: React.ReactNode;
  readonly actions: React.ReactNode;
  readonly tone?: CardTone;
  readonly className?: string;
}

/**
 * The head every content card shares (PAGE-382), and with it the split view
 * and the image viewer: the icon of the kind in a light field of the accent
 * color, the name in bold, below it kind, size or count and remaining time,
 * and the actions on the right.
 */
export function CardHead({
  icon: Icon,
  name,
  subtitle,
  actions,
  tone = "light",
  className,
}: CardHeadProps): React.ReactElement {
  const isDark = tone === "dark";
  return (
    <header
      className={cn(
        "flex min-h-12 flex-wrap items-center gap-x-2.5 gap-y-1.5 px-3 py-2",
        className,
      )}
      data-card-head={tone}
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg",
          isDark ? "bg-viewer-control text-primary" : "bg-primary-subtle text-primary",
        )}
      >
        <Icon aria-hidden="true" className="size-4" />
      </span>
      <p className="flex min-w-32 flex-1 flex-col leading-tight">
        <span
          className={cn(
            "truncate text-[13px] font-semibold",
            isDark && "text-viewer-foreground",
          )}
        >
          {name}
        </span>
        <span
          className={cn(
            "truncate text-xs",
            isDark ? "text-viewer-muted" : "text-muted-foreground",
          )}
        >
          {subtitle}
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-1">{actions}</div>
    </header>
  );
}

/**
 * Joins the parts of a subtitle with " · ", leaving out empty ones.
 *
 * @param parts - Kind, size or count, remaining time and the like.
 */
export function subtitleOf(
  parts: readonly (string | null | undefined)[],
): string {
  return parts.filter((part) => part !== null && part !== undefined && part !== "").join(" · ");
}

/** Props of the frame every content card of the chat shares. */
export interface ContentCardProps {
  /** Stable per message and card; the remembered state is kept under it. */
  readonly cardKey: string;
  readonly icon: LucideIcon;
  readonly name: string;
  /** The kind as the head names it, such as `TypeScript`, `Diff` or `PDF`. */
  readonly kindLabel: string;
  /** Size or length next to the kind, such as `9 Zeilen` or `1,2 MB`. */
  readonly meta?: React.ReactNode;
  /** How long the file stays on the server, such as "noch 2 Tage" (PAGE-382). */
  readonly retention?: string | null;
  /** The state without a choice of the person. */
  readonly defaultState: ChatCardState;
  /** The main action "Herunterladen" in the accent color (PAGE-382). */
  readonly download?: CardDownload;
  /** Further actions of the kind, after the download and before the line. */
  readonly actions?: React.ReactNode;
  /** Opens in the split view when given; cards without it have no "Daneben". */
  readonly beside?: OpenedCard;
  /** Offers "Vollbild" when given. */
  readonly onFullscreen?: () => void;
  /** The content of the expanded card; not rendered while collapsed. */
  readonly children: React.ReactNode;
  readonly className?: string;
}

/**
 * The frame of a content card (PAGE-298, PAGE-382): the shared head and
 * below it the content.
 *
 * @remarks
 * The actions keep a fixed order: "Herunterladen" in the accent color, the
 * actions of the kind, a thin line, then "Daneben" and "Vollbild" as quiet
 * icon buttons and "Zuklappen" on the far right; an action a kind lacks is
 * left out without moving the others. A card is collapsed to its head,
 * expanded in the message, or opened next to the chat; the person's last
 * choice between collapsed and expanded is remembered per card. While the
 * split view shows the card, its frame and its "Daneben" take the accent color.
 */
export function ContentCard({
  cardKey,
  icon,
  name,
  kindLabel,
  meta,
  retention,
  defaultState,
  download,
  actions,
  beside,
  onFullscreen,
  children,
  className,
}: ContentCardProps): React.ReactElement {
  const { t } = useTranslation();
  const content = useChatContent();
  const isExpanded = content.stateOf(cardKey, defaultState) === "expanded";
  const isBeside = content.beside?.key === cardKey;
  const ToggleIcon = isExpanded ? ChevronUp : ChevronDown;

  function handleBeside(): void {
    if (isBeside) content.closeBeside();
    else if (beside) content.openBeside(beside);
  }

  const subtitle = (
    <>
      {kindLabel === name ? null : kindLabel}
      {meta && kindLabel !== name ? " · " : null}
      {meta}
      {retention ? ` · ${retention}` : null}
    </>
  );

  return (
    <section
      aria-label={name}
      className={cn(
        "w-full max-w-3xl min-w-0 overflow-hidden rounded-xl border bg-surface text-foreground shadow-xs",
        isBeside ? "border-primary" : "border-border",
        className,
      )}
      data-card-state={isExpanded ? "expanded" : "collapsed"}
      data-content-card={cardKey}
    >
      <CardHead
        actions={
          <>
            {download ? (
              <CardDownloadAction download={download} />
            ) : null}
            {isExpanded ? actions : null}
            {download || (isExpanded && actions) ? <CardActionDivider /> : null}
            {beside ? (
              <CardAction
                icon={PanelRight}
                isActive={isBeside}
                isIconOnly
                label={
                  isBeside
                    ? t("chatPage.cards.besideOpen")
                    : t("chatPage.cards.beside")
                }
                onClick={handleBeside}
                variant="quiet"
              />
            ) : null}
            {onFullscreen ? (
              <CardAction
                icon={Maximize2}
                isIconOnly
                label={t("chatPage.cards.fullscreen")}
                onClick={onFullscreen}
                variant="quiet"
              />
            ) : null}
            <CardAction
              icon={ToggleIcon}
              isIconOnly
              label={
                isExpanded
                  ? t("chatPage.cards.collapse")
                  : t("chatPage.cards.expand")
              }
              onClick={() =>
                content.setState(cardKey, isExpanded ? "collapsed" : "expanded")
              }
              variant="quiet"
            />
          </>
        }
        icon={icon}
        name={name}
        subtitle={subtitle}
      />
      {isExpanded ? (
        <div className="border-t border-border">{children}</div>
      ) : null}
    </section>
  );
}
