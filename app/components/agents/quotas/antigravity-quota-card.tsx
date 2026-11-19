import { useTranslation } from "react-i18next";

/*
 * Branding note: Antigravity's app icon names the tool of the connection
 * beside its written name; the file is kept unchanged in `assets/providers/`
 * and only scaled here.
 */
import antigravityUrl from "@/assets/providers/logo-antigravity.png?no-inline";

import { cn } from "@/app/lib/cn";
import {
  ANTIGRAVITY_QUOTA_WINDOWS,
  antigravityGroupFamily,
} from "@/definition/AntigravityQuota";

import styles from "./antigravity-quota-card.module.css";
import { AntigravityQuotaWindow } from "./antigravity-quota-window";
import { QuotaCardFrame } from "./quota-card-frame";
import {
  QUOTA_GROUP_LIST_CLASS,
  QUOTA_GROUP_SLOT_CLASS,
  QUOTA_GROUPS_AREA_CLASS,
  VISIBLE_GROUPS,
} from "./quota-card-layout";
import { antigravityCardView } from "./quota-card-state";
import { QuotaNotice } from "./quota-notice";
import { QuotaGroupsPlaceholder } from "./quota-placeholders";
import { QuotaStatusLine } from "./quota-status-line";
import { useRefreshHint } from "./use-refresh-hint";

import type { TFunction } from "i18next";
import type {
  AntigravityGroupFamily,
  AntigravityQuotaAccount,
  AntigravityQuotaGroup as QuotaGroup,
} from "@/definition/AntigravityQuota";
import type { AntigravityCardBody } from "./quota-card-state";
import type { StatusLimit } from "./quota-status-presentation";

/**
 * The card of one Antigravity connection: its name, the model groups
 * Antigravity reported and what happened at the last query.
 * @remarks
 * It is the card of the Claude connections with another logo, another
 * subtitle and groups instead of windows, and the same size: the head is
 * 44 px, the status line 48 px, and the card keeps its height whatever it
 * holds. The answer names no subscription, so the head shows no plan badge;
 * with more than two groups it shows "n Gruppen" on the right. A group or
 * window Antigravity did not report is not shown, and one whose reset passed
 * leaves the card. A window without a rest keeps its mark at the window, and
 * the status line names it together with its group, also when the group is
 * out of sight in the scrolled list. A card without stored figures shows
 * placeholders and "Wird geladen …" until its query answers; a card with
 * stored figures keeps them in full colour while the query runs.
 */
export function AntigravityQuotaCard({
  account,
  pendingQueries,
  now,
  onRetry,
}: {
  readonly account: AntigravityQuotaAccount;
  /** Queries of exactly this card that have not answered yet. */
  readonly pendingQueries: number;
  readonly now: Date;
  readonly onRetry: (connectionId: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const isQuerying = pendingQueries > 0;
  const view = antigravityCardView(account, now);
  const isLoading = view.status.kind === "stored" && view.status.at === null;
  const isHintShown = useRefreshHint(isQuerying && !isLoading);
  const groupCount = view.body.kind === "groups" ? view.body.groups.length : 0;
  const limit: StatusLimit | null = view.limit
    ? {
        group: antigravityGroupLabel(view.limit.groupName, t),
        window: view.limit.window.kind,
        resetsAt: view.limit.window.resetsAt,
      }
    : null;

  function handleRetry(): void {
    onRetry(account.connectionId);
  }

  return (
    <QuotaCardFrame
      connectionId={account.connectionId}
      provider="antigravity"
      isLoading={isLoading}
      isQuerying={isQuerying}
    >
      <header className="flex h-11 shrink-0 items-center gap-3">
        <img
          src={antigravityUrl}
          alt=""
          draggable={false}
          className="size-8 shrink-0 rounded-[9px]"
        />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-bold text-foreground">
            {account.name}
          </h3>
          <p className="truncate text-xs text-muted-foreground">
            {t("agentsPage.card.antigravity")}
          </p>
        </div>
        {groupCount > VISIBLE_GROUPS ? (
          <p
            data-quota-group-count={groupCount}
            className="shrink-0 text-xs font-semibold text-muted-foreground"
          >
            {t("agentsPage.antigravity.groupCount", { count: groupCount })}
          </p>
        ) : null}
      </header>
      {isLoading ? (
        <QuotaGroupsPlaceholder />
      ) : (
        <AntigravityGroupArea body={view.body} now={now} />
      )}
      <QuotaStatusLine
        status={view.status}
        now={now}
        source={{ provider: "antigravity", limit }}
        progress={{ isQuerying, isHintShown }}
        onRetry={handleRetry}
      />
    </QuotaCardFrame>
  );
}

function AntigravityQuotaGroupSlot({
  group,
  now,
  isStale,
}: {
  readonly group: QuotaGroup;
  readonly now: Date;
  readonly isStale: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const label = antigravityGroupLabel(group.name, t);
  return (
    <li
      data-quota-group={group.name}
      className={cn(QUOTA_GROUP_SLOT_CLASS, "snap-start")}
    >
      <div className="flex h-4 items-center gap-2">
        <span
          aria-hidden="true"
          className={cn(
            "size-2 shrink-0 rounded-full",
            GROUP_DOT_CLASSES[antigravityGroupFamily(group.name)],
          )}
        />
        <h4 className="truncate text-xs font-bold text-foreground">{label}</h4>
      </div>
      <div className="grid min-h-0 grid-cols-2 gap-[18px]">
        {ANTIGRAVITY_QUOTA_WINDOWS.map((kind) => {
          const quotaWindow = group.windows.find(
            (window) => window.kind === kind,
          );
          return quotaWindow ? (
            <AntigravityQuotaWindow
              key={kind}
              quotaWindow={quotaWindow}
              groupLabel={label}
              now={now}
              isStale={isStale}
            />
          ) : (
            <div key={kind} aria-hidden="true" />
          );
        })}
      </div>
    </li>
  );
}

function AntigravityGroupArea({
  body,
  now,
}: {
  readonly body: AntigravityCardBody;
  readonly now: Date;
}): React.ReactElement {
  const { t } = useTranslation();
  if (body.kind === "notice")
    return (
      <div data-quota-groups="notice" className={QUOTA_GROUPS_AREA_CLASS}>
        <QuotaNotice
          notice={body.notice}
          provider="antigravity"
          hasPlan={false}
        />
      </div>
    );
  const items = (
    <ul className={QUOTA_GROUP_LIST_CLASS}>
      {body.groups.map((group, position) => (
        <AntigravityQuotaGroupSlot
          key={`${position}:${group.name}`}
          group={group}
          now={now}
          isStale={body.isStale}
        />
      ))}
    </ul>
  );
  const isScrollable = body.groups.length > VISIBLE_GROUPS;
  return (
    <div
      data-quota-groups={body.groups.length}
      className={QUOTA_GROUPS_AREA_CLASS}
    >
      {isScrollable ? (
        <div
          role="region"
          tabIndex={0}
          aria-label={t("agentsPage.antigravity.groupList")}
          data-quota-group-list="scroll"
          className={cn(
            styles.groupList,
            "-mr-[14px] h-[188px] shrink-0 snap-y snap-mandatory overflow-y-auto overscroll-contain pr-[10px] focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring md:-mr-[18px] md:pr-[14px]",
          )}
        >
          {items}
        </div>
      ) : (
        items
      )}
    </div>
  );
}

const GROUP_DOT_CLASSES: Readonly<Record<AntigravityGroupFamily, string>> = {
  gemini: "bg-antigravity",
  claude_gpt: "bg-claude",
  other: "bg-claude",
};

function antigravityGroupLabel(name: string, t: TFunction): string {
  const family = antigravityGroupFamily(name);
  if (family === "gemini") return t("agentsPage.antigravity.group.gemini");
  if (family === "claude_gpt")
    return t("agentsPage.antigravity.group.claudeGpt");
  return name;
}
