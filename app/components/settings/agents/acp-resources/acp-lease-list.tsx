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
      className="underline underline-offset-2"
    >
      {t("settings.agents.resources.entry.plan", { name: run.planName })}
    </Link>
  );
}

/** Technical identifiers stay available, but only as supplementary detail. */
function LeaseDetails({
  entry,
}: {
  readonly entry: Lease | WaitingRequest;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer">
        {t("settings.agents.resources.entry.details")}
      </summary>
      <p className="break-all">
        {t("settings.agents.resources.entry.instance")}: {entry.instanceId}
      </p>
      {entry.runId ? (
        <p className="break-all">
          {t("settings.agents.resources.entry.run")}: {entry.runId}
          {entry.stepId
            ? ` · ${t("settings.agents.resources.entry.step")}: ${entry.stepId}`
            : ""}
        </p>
      ) : null}
    </details>
  );
}

/** Explains why an unconfirmed reservation stays and what the safe next step is. */
function LeaseReason({
  entry,
  isOwned,
}: {
  readonly entry: Lease;
  readonly isOwned: boolean;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (entry.state !== "cleanup_failed") return null;
  const reason = entry.check?.reason ?? "unchecked";
  return (
    <div className="space-y-1 text-muted-foreground">
      <p>
        {t(`settings.agents.resources.reason.${reason}`, {
          instance: entry.instanceId,
        })}
      </p>
      {entry.check ? (
        <p className="text-xs">
          {t("settings.agents.resources.entry.lastCheck")}{" "}
          <AgentCheckTime checkedAt={entry.check.at} />
        </p>
      ) : null}
      {isOwned ? null : (
        <p className="text-xs">
          {t("settings.agents.resources.entry.otherService")}
        </p>
      )}
    </div>
  );
}

function LeaseItem({
  entry,
  run,
  chat,
  isOwned,
}: {
  readonly entry: Lease;
  readonly run: AcpResourceRunReference | undefined;
  readonly chat: AcpChatSessionView | undefined;
  readonly isOwned: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <li className="space-y-1 rounded-md border border-border p-3">
      <p className="font-medium">
        {t(`settings.agents.providerShort.${entry.provider}`)} ·{" "}
        <LeaseOrigin runId={entry.runId} run={run} chat={chat} />
      </p>
      <p>
        {t(`settings.agents.resources.${entry.state}`)}
        {entry.isPaused ? ` · ${t("settings.agents.resources.paused")}` : ""}
        {" · "}
        {t(`settings.agents.resources.process.${entry.process ?? "unknown"}`)}
      </p>
      <p className="text-muted-foreground">
        {t("settings.agents.resources.entry.age")}{" "}
        <AgentCheckTime checkedAt={entry.since} />
      </p>
      <LeaseReason entry={entry} isOwned={isOwned} />
      <LeaseDetails entry={entry} />
    </li>
  );
}

/** Lists reservations and waiting requests by provider, plan or Pica chat, and age. */
export function AcpLeaseList({
  resources,
}: {
  readonly resources: AcpResourceDiagnostics;
}): React.ReactElement {
  const { t } = useTranslation();
  const runs = new Map(
    (resources.runs ?? []).map((reference) => [reference.runId, reference]),
  );
  const scope = resources.check?.scope ?? "all";
  const chats = new Map(
    (resources.chatSessions ?? []).map((chat) => [chat.instanceId, chat]),
  );
  return (
    <ul className="space-y-2">
      {resources.active.map((entry) => (
        <LeaseItem
          key={entry.instanceId}
          entry={entry}
          run={entry.runId === null ? undefined : runs.get(entry.runId)}
          chat={chats.get(entry.instanceId)}
          isOwned={isOwnedBy(scope, entry.runId)}
        />
      ))}
      {resources.waiting.map((entry) => (
        <li
          key={entry.instanceId}
          className="space-y-1 rounded-md border border-dashed border-border p-3 text-muted-foreground"
        >
          <p>
            {t(`settings.agents.providerShort.${entry.provider}`)} ·{" "}
            <LeaseOrigin
              runId={entry.runId}
              run={entry.runId === null ? undefined : runs.get(entry.runId)}
            />{" "}
            · {t(`settings.agents.resources.${entry.reason}`)}
          </p>
          <p>
            {t("settings.agents.resources.entry.waitingSince")}{" "}
            <AgentCheckTime checkedAt={entry.since} />
          </p>
          <LeaseDetails entry={entry} />
        </li>
      ))}
    </ul>
  );
}
