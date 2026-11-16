import { Bot, Clock, EyeOff, Search, User } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { cn } from "@/app/lib/cn";
import { CONVERSATION_MEDIA_TABS } from "@/definition/ConversationMediaOverview";

import type { LucideIcon } from "lucide-react";
import type {
  ConversationMediaSender,
  ConversationMediaTab,
} from "@/definition/ConversationMediaOverview";
import type { MediaOverviewState } from "./use-media-overview-state";

/** The tabs with the count of what each one shows. */
export function MediaTabs({
  state,
  counts,
}: {
  readonly state: Pick<MediaOverviewState, "tab" | "selectTab">;
  readonly counts: Readonly<Record<ConversationMediaTab, number>>;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div
      aria-label={t("chatPage.media.tabsLabel")}
      className="flex gap-1 overflow-x-auto px-3 pt-2"
      role="tablist"
    >
      {CONVERSATION_MEDIA_TABS.map((tab) => {
        const isActive = state.tab === tab;
        return (
          <button
            key={tab}
            aria-selected={isActive}
            className={cn(
              "flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-primary",
              isActive
                ? "bg-primary-subtle text-primary"
                : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
            )}
            data-media-tab={tab}
            onClick={() => state.selectTab(tab)}
            role="tab"
            type="button"
          >
            {t(`chatPage.media.tabs.${tab}`)}
            <span className="rounded-full bg-surface-hover px-1.5 text-[11px] tabular-nums">
              {counts[tab]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** A filter that is on or off, lit in the accent color while on. */
function FilterToggle({
  icon: Icon,
  label,
  isOn,
  onToggle,
}: {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly isOn: boolean;
  readonly onToggle: () => void;
}): React.ReactElement {
  return (
    <button
      aria-pressed={isOn}
      className={cn(
        "flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-primary",
        isOn
          ? "border-primary bg-primary-subtle text-primary"
          : "border-border bg-surface text-foreground hover:bg-surface-hover",
      )}
      onClick={onToggle}
      type="button"
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {label}
    </button>
  );
}

/** The options of the filter by sender: everybody, then each person and agent. */
function senderOptions(
  senders: readonly ConversationMediaSender[],
  t: (key: string) => string,
): {
  value: string;
  label: string;
  icon?: React.ReactNode;
  description?: string;
}[] {
  return [
    { value: "", label: t("chatPage.media.senderAll") },
    ...senders.map((sender) => {
      const Icon = sender.kind === "agent" ? Bot : User;
      return {
        value: sender.id,
        label: sender.name,
        icon: <Icon className="size-3.5" />,
        description: t(`chatPage.media.senderKind.${sender.kind}`),
      };
    }),
  ];
}

/**
 * The search by name or link title, the filter by sender, "läuft bald ab"
 * (below 24 hours) and the switch that hides expired files.
 */
export function MediaFilters({
  state,
  senders,
}: {
  readonly state: Pick<MediaOverviewState, "filter" | "changeFilter">;
  readonly senders: readonly ConversationMediaSender[];
}): React.ReactElement {
  const { t } = useTranslation();
  const { filter, changeFilter } = state;
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2">
      <label className="relative min-w-40 flex-1">
        <span className="sr-only">{t("chatPage.media.searchLabel")}</span>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          className="pl-8"
          onChange={(event) => changeFilter({ query: event.target.value })}
          placeholder={t("chatPage.media.search")}
          size="sm"
          type="search"
          value={filter.query}
        />
      </label>
      <Select
        ariaLabel={t("chatPage.media.sender")}
        className="max-w-48"
        onValueChange={(value) =>
          changeFilter({ senderId: value === "" ? null : value })
        }
        options={senderOptions(senders, t)}
        value={filter.senderId ?? ""}
      />
      <FilterToggle
        icon={Clock}
        isOn={filter.isExpiringSoon}
        label={t("chatPage.media.expiringSoon")}
        onToggle={() =>
          changeFilter({ isExpiringSoon: !filter.isExpiringSoon })
        }
      />
      <FilterToggle
        icon={EyeOff}
        isOn={filter.isExpiredHidden}
        label={t("chatPage.media.hideExpired")}
        onToggle={() =>
          changeFilter({ isExpiredHidden: !filter.isExpiredHidden })
        }
      />
    </div>
  );
}
