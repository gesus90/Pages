import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { SegmentedControl } from "@/app/components/ui/segmented-control";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";

import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { AgentCheckTime } from "../agent-check-time";

import type {
  AcpChatSessionView,
  AcpRecoveryScope,
  AcpResourceDiagnostics,
  AcpResourceRunReference,
} from "@/definition/AcpResource";

type Lease = AcpResourceDiagnostics["active"][number];
type WaitingRequest = AcpResourceDiagnostics["waiting"][number];

function isOwnedBy(scope: AcpRecoveryScope, runId: string | null): boolean {
  if (scope === "all") return true;
  return scope === "plans" ? runId !== null : runId === null;
}

/** Names the plan of a run, the kept chat session of an agent or the Pica chat behind a reservation. */
function LeaseOrigin({
  runId,
  run,
  chat,
}: {
  readonly runId: string | null;
  readonly run: AcpResourceRunReference | undefined;
  readonly chat?: AcpChatSessionView;
}): React.ReactElement {
  const { t } = useTranslation();
  if (chat)
    return (
      <span>
        {t("settings.agents.resources.entry.agentChat", {
          agent: chat.agentName,
          conversation: chat.conversation,
        })}
      </span>
    );
  if (runId === null)
    return <span>{t("settings.agents.resources.entry.pica")}</span>;
  if (!run)
    return <span>{t("settings.agents.resources.entry.planUnknown")}</span>;
  return (
    <Link
      to={`/agents/plans?planId=${encodeURIComponent(run.planId)}`}
      className="relative z-10 underline underline-offset-2"
    >
      {t("settings.agents.resources.entry.plan", { name: run.planName })}
    </Link>
  );
}

type Filter = "all" | "unconfirmed" | "active" | "waiting";
type Entry = Lease | WaitingRequest;

function LeaseRow({
  entry,
  run,
  chat,
  isOwned,
}: {
  readonly entry: Entry;
  readonly run: AcpResourceRunReference | undefined;
  readonly chat: AcpChatSessionView | undefined;
  readonly isOwned: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  let state = "waiting";
  if ("state" in entry) {
    state = entry.state;
    if (entry.isPaused && entry.state !== "cleanup_failed") state = "paused";
  }
  const tones: Record<string, string> = {
    cleanup_failed: "bg-warning-subtle text-warning",
    running: "bg-info-subtle text-info",
    starting: "bg-status-active-subtle text-status-active",
    closing: "bg-status-active-subtle text-status-active",
    idle: "bg-muted text-muted-foreground",
    paused: "bg-muted text-foreground",
    waiting: "bg-muted text-muted-foreground",
  };
  return (
    <div className="border-b border-border last:border-b-0">
      <div className="relative flex h-10 items-center gap-2 px-3.5 text-xs">
        <span className="min-w-0 flex-1 truncate">
          <span className="font-semibold">
            {t(`settings.agents.providerShort.${entry.provider}`)}
          </span>
          {" · "}
          <LeaseOrigin runId={entry.runId} run={run} chat={chat} />
        </span>
        <span
          className={`rounded-md px-2 py-1 text-xs leading-4 font-semibold ${tones[state]}`}
        >
          {t(`settings.agents.resources.badge.${state}`)}
        </span>
        <span className="text-right text-muted-foreground">
          <AgentCheckTime checkedAt={entry.since} />
        </span>
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={t("settings.agents.resources.entry.details")}
          onClick={() => setExpanded(!expanded)}
          className="absolute inset-x-0 h-10 cursor-pointer"
        />
        <ChevronRight
          aria-hidden="true"
          className={`pointer-events-none size-4 shrink-0 ${expanded ? "rotate-90" : ""}`}
        />
      </div>
      {expanded ? (
        <div className="space-y-1 pb-3 pl-9 pr-3.5 text-xs text-muted-foreground">
          <p>
            {"state" in entry
              ? t(`settings.agents.resources.${entry.state}`)
              : t(`settings.agents.resources.${entry.reason}`)}
          </p>
          {"state" in entry && entry.state === "cleanup_failed" ? (
            <p>
              {t(
                `settings.agents.resources.reason.${entry.check?.reason ?? "unchecked"}`,
                { instance: entry.instanceId },
              )}
            </p>
          ) : null}
          {"state" in entry && entry.check ? (
            <p>
              {t("settings.agents.resources.entry.lastCheck")}{" "}
              <AgentCheckTime checkedAt={entry.check.at} />
            </p>
          ) : null}
          {!isOwned ? (
            <p>{t("settings.agents.resources.entry.otherService")}</p>
          ) : null}
          <p className="break-all">
            {t("settings.agents.resources.entry.instance")}: {entry.instanceId}
          </p>
          {entry.runId ? (
            <p className="break-all">
              {t("settings.agents.resources.entry.run")}: {entry.runId}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Lists reservations and waiting requests in a bounded, filterable panel. */
export function AcpLeaseList({
  resources,
}: {
  readonly resources: AcpResourceDiagnostics;
}): React.ReactElement {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<Filter>("all");
  const unconfirmed = resources.active.filter(
    (entry) => entry.state === "cleanup_failed",
  );
  const active = resources.active.filter(
    (entry) => entry.state !== "cleanup_failed",
  );
  const groups = [
    { key: "unconfirmed" as const, entries: unconfirmed },
    { key: "active" as const, entries: active },
    { key: "waiting" as const, entries: resources.waiting },
  ];
  const runs = new Map((resources.runs ?? []).map((run) => [run.runId, run]));
  const chats = new Map(
    (resources.chatSessions ?? []).map((chat) => [chat.instanceId, chat]),
  );
  const scope = resources.check?.scope ?? "all";
  return (
    <div className="space-y-2">
      {unconfirmed.length > 0 ? (
        <p role="status" className="text-xs text-warning">
          {t("settings.agents.resources.unconfirmedNotice", {
            count: unconfirmed.length,
          })}
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <SegmentedControl<Filter>
          value={filter}
          onValueChange={setFilter}
          ariaLabel={t("settings.agents.resources.filter.label")}
          options={[
            {
              value: "all",
              label: `${t("settings.agents.resources.filter.all")} ${resources.active.length + resources.waiting.length}`,
            },
            {
              value: "unconfirmed",
              label: t("settings.agents.resources.filter.unconfirmed"),
              trailing: (
                <span className="rounded-full bg-warning-subtle px-1.5 text-[11px] font-semibold text-warning">
                  {unconfirmed.length}
                </span>
              ),
            },
            {
              value: "active",
              label: `${t("settings.agents.resources.filter.active")} ${active.length}`,
            },
            {
              value: "waiting",
              label: `${t("settings.agents.resources.filter.waiting")} ${resources.waiting.length}`,
            },
          ]}
        />
      </div>
      <VerticalScrollArea className="max-h-[440px] rounded-xl border border-border">
        {groups
          .filter(
            (group) =>
              group.entries.length > 0 &&
              (filter === "all" || filter === group.key),
          )
          .map((group) => (
            <section key={group.key}>
              <div className="sticky top-0 z-10 flex h-8 items-center justify-between bg-muted px-3.5 text-xs font-semibold text-muted-foreground">
                <span>{t(`settings.agents.resources.group.${group.key}`)}</span>
                <span>{group.entries.length}</span>
              </div>
              {group.entries.map((entry) => (
                <LeaseRow
                  key={entry.instanceId}
                  entry={entry}
                  run={entry.runId === null ? undefined : runs.get(entry.runId)}
                  chat={chats.get(entry.instanceId)}
                  isOwned={isOwnedBy(scope, entry.runId)}
                />
              ))}
            </section>
          ))}
      </VerticalScrollArea>
    </div>
  );
}
