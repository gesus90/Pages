import { ChevronDown, ChevronUp, PanelRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { useChatContent } from "./chat-content-context";

import type { LucideIcon } from "lucide-react";
import type { ChatCardState } from "@/definition/ConversationContent";
import type { OpenedCard } from "./card-types";

const ACTION_CLASS =
  "inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border bg-surface px-2 text-xs font-medium text-foreground hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

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
}: CardActionProps): React.ReactElement {
  const className = cn(ACTION_CLASS, isActive && "border-primary");
  const content = (
    <>
      {Icon ? <Icon aria-hidden="true" className="size-3.5" /> : null}
      {isIconOnly ? <span className="sr-only">{label}</span> : label}
    </>
  );
  if (href === undefined)
    return (
      <button
        aria-pressed={isActive ? true : undefined}
        className={className}
        onClick={onClick}
        title={isIconOnly ? label : undefined}
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
      title={isIconOnly ? label : undefined}
    >
      {content}
    </a>
  ) : (
    <a
      className={className}
      download=""
      href={href}
      title={isIconOnly ? label : undefined}
    >
      {content}
    </a>
  );
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
  /** The state without a choice of the person. */
  readonly defaultState: ChatCardState;
  /** The actions of the kind, before "Daneben" and the toggle. */
  readonly actions?: React.ReactNode;
  /** Opens in the split view when given; cards without it have no "Daneben". */
  readonly beside?: OpenedCard;
  /** The content of the expanded card; not rendered while collapsed. */
  readonly children: React.ReactNode;
  readonly className?: string;
}

/**
 * The frame of a content card (PAGE-298): a head with name, kind, size or
 * length and the actions, and below it the content.
 *
 * @remarks
 * A card is collapsed to its head line, expanded in the message, or opened
 * next to the chat. The person's last choice between collapsed and expanded
 * is remembered per card. While the split view shows the card, its frame
 * takes the accent color and says "Rechts geöffnet".
 */
export function ContentCard({
  cardKey,
  icon: Icon,
  name,
  kindLabel,
  meta,
  defaultState,
  actions,
  beside,
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
      <header className="flex min-h-10 flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon aria-hidden="true" className="size-3.5" />
        </span>
        <p className="flex min-w-32 flex-1 items-baseline gap-2 text-[13px]">
          <span className="truncate font-semibold">{name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {kindLabel === name ? null : kindLabel}
            {meta && kindLabel !== name ? " · " : null}
            {meta}
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {isExpanded ? actions : null}
          {beside ? (
            <CardAction
              icon={PanelRight}
              isActive={isBeside}
              label={
                isBeside
                  ? t("chatPage.cards.besideOpen")
                  : t("chatPage.cards.beside")
              }
              onClick={handleBeside}
            />
          ) : null}
          <CardAction
            icon={ToggleIcon}
            label={
              isExpanded
                ? t("chatPage.cards.collapse")
                : t("chatPage.cards.expand")
            }
            onClick={() =>
              content.setState(cardKey, isExpanded ? "collapsed" : "expanded")
            }
          />
        </div>
      </header>
      {isExpanded ? (
        <div className="border-t border-border">{children}</div>
      ) : null}
    </section>
  );
}
