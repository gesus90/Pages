import { Cpu } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { SettingsCard } from "@/app/components/settings/settings-layout";
import { observerFailureText } from "@/app/lib/observer-failure-text";

import { AcpResourceLimitForm } from "./acp-resource-limit-form";
import { AcpChatSessionList } from "./acp-resources/acp-chat-session-list";
import { AcpLeaseCleanup } from "./acp-resources/acp-lease-cleanup";
import { AcpLeaseList } from "./acp-resources/acp-lease-list";
import { AcpResourceOverview } from "./acp-resources/acp-resource-overview";
import { AgentCheckTime } from "./agent-check-time";

import type {
  AcpCredentialLeftover,
  AcpLeaseCheckSummary,
  AcpResourceDiagnostics,
  AcpResourceSnapshot,
} from "@/definition/AcpResource";
import type { ConversationObserverHealth } from "@/definition/ConversationObserver";

interface AcpResourcesCardProps {
  readonly canConfigure?: boolean;
}

function AcpLeaseCheckStatus({
  check,
}: {
  readonly check: AcpLeaseCheckSummary | undefined;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (!check) return null;
  const isFailed = check.outcome === "failed";
  return (
    <section
      aria-label={t("settings.agents.resources.check.title", {
        minutes: check.intervalMinutes,
      })}
      className="space-y-1 rounded-md border border-border p-3"
    >
      <p className="font-medium">
        {t("settings.agents.resources.check.title", {
          minutes: check.intervalMinutes,
        })}
      </p>
      <p className="text-muted-foreground">
        {t("settings.agents.resources.check.last")}{" "}
        {check.lastAt ? (
          <AgentCheckTime checkedAt={check.lastAt} />
        ) : (
          t("settings.agents.resources.check.never")
        )}{" "}
        · {t("settings.agents.resources.check.next")}{" "}
        {check.nextAt ? (
          <AgentCheckTime checkedAt={check.nextAt} />
        ) : (
          t("settings.agents.resources.check.running")
        )}
      </p>
      <p
        role={isFailed ? "alert" : "status"}
        className={isFailed ? "text-destructive" : undefined}
      >
        {t(`settings.agents.resources.check.outcome.${check.outcome}`, {
          checked: check.checked,
          released: check.released,
          unconfirmed: check.unconfirmed,
          failed: check.failed,
        })}
      </p>
      {check.scope === "all" ? null : (
        <p className="text-muted-foreground">
          {t(`settings.agents.resources.check.scope.${check.scope}`)}
        </p>
      )}
    </section>
  );
}

function AcpObserverHealth({
  observer,
}: {
  readonly observer: ConversationObserverHealth | undefined;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (!observer) return null;
  const calls = observer.succeeded + observer.failed + observer.refused;
  const isFailing =
    observer.lastFailure !== null && observer.failed + observer.refused > 0;
  return (
    <section
      aria-label={t("settings.agents.resources.observer.title")}
      className="space-y-1 rounded-md border border-border p-3"
    >
      <p className="font-medium">
        {t("settings.agents.resources.observer.title")}
      </p>
      <p className="text-muted-foreground">
        {calls === 0
          ? t("settings.agents.resources.observer.none")
          : t("settings.agents.resources.observer.summary", {
              succeeded: observer.succeeded,
              failed: observer.failed,
              refused: observer.refused,
            })}
      </p>
      {observer.lastSuccessAt ? (
        <p className="text-muted-foreground">
          {t("settings.agents.resources.observer.lastSuccess")}{" "}
          <AgentCheckTime checkedAt={observer.lastSuccessAt} />
        </p>
      ) : null}
      {isFailing && observer.lastFailure ? (
        <div role="alert" className="space-y-1 text-destructive">
          <p>
            {t(
              `settings.agents.resources.observer.lastFailure.${observer.lastFailure.kind}`,
            )}{" "}
            <AgentCheckTime checkedAt={observer.lastFailure.at} />
          </p>
          <p>{observerFailureText(t, observer.lastFailure)}</p>
          <p className="text-xs">
            {t("settings.agents.resources.observer.reservations")}
          </p>
        </div>
      ) : null}
    </section>
  );
}

function LeftoverNotice({
  leftovers,
}: {
  readonly leftovers: readonly AcpCredentialLeftover[];
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3"
    >
      <p className="font-medium text-destructive">
        {t("settings.agents.resources.leftovers")}
      </p>
      <ul className="space-y-1">
        {leftovers.map((leftover) => (
          <li key={leftover.directory} className="break-words">
            {t(`settings.agents.resources.leftover.${leftover.reason}`, {
              directory: leftover.directory,
              instance: leftover.instanceId,
            })}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResourceDetails({
  resources,
}: {
  readonly resources: AcpResourceDiagnostics;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="space-y-3 text-sm">
      <AcpResourceOverview resources={resources} />
      {resources.problem ? (
        <p role="alert" className="text-destructive">
          {t("settings.agents.resources.storage")}
        </p>
      ) : null}
      <AcpLeaseCheckStatus check={resources.check} />
      <AcpObserverHealth observer={resources.observer} />
      {resources.leftovers.length > 0 ? (
        <LeftoverNotice leftovers={resources.leftovers} />
      ) : null}
      <AcpLeaseList resources={resources} />
      {resources.chatSessions ? (
        <AcpChatSessionList sessions={resources.chatSessions} />
      ) : null}
    </div>
  );
}

/** Polls the authorized resource endpoint without starting native processes or provider checks. */
export function AcpResourcesCard({
  canConfigure = false,
}: AcpResourcesCardProps): React.ReactElement {
  const { t } = useTranslation();
  const { data: resources, load } = useFetcher<
    AcpResourceDiagnostics | { error: string }
  >({ key: "acp-resources" });
  const [applied, setApplied] = useState<{
    readonly previous: typeof resources;
    readonly snapshot: AcpResourceSnapshot;
  } | null>(null);
  useEffect(() => {
    void load("/agent-api/resources");
    const timer = setInterval(() => {
      void load("/agent-api/resources");
    }, 5000);
    return () => clearInterval(timer);
  }, [load]);
  let current = resources;
  if (current && "active" in current && applied?.previous === current)
    current = { ...current, ...applied.snapshot };

  function handleApplied(snapshot: AcpResourceSnapshot): void {
    setApplied({ previous: resources, snapshot });
    void load("/agent-api/resources");
  }

  function handleCleaned(): void {
    void load("/agent-api/resources");
  }

  return (
    <SettingsCard
      title={t("settings.agents.resources.title")}
      description={t("settings.agents.resources.description")}
      icon={<Cpu className="size-4" aria-hidden="true" />}
    >
      {current && "active" in current ? (
        <div className="space-y-4">
          {canConfigure ? (
            <AcpResourceLimitForm
              resources={current}
              onApplied={handleApplied}
            />
          ) : null}
          {canConfigure ? <AcpLeaseCleanup onCleaned={handleCleaned} /> : null}
          <ResourceDetails resources={current} />
        </div>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          {t("settings.agents.resources.unavailable")}
        </p>
      )}
    </SettingsCard>
  );
}
