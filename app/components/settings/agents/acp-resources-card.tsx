import { Cpu } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { SettingsCard } from "@/app/components/settings/settings-layout";

import { AcpResourceLimitForm } from "./acp-resource-limit-form";

import type {
  AcpCredentialLeftover,
  AcpResourceDiagnostics,
  AcpResourceSnapshot,
} from "@/definition/AcpResource";

interface AcpResourcesCardProps {
  readonly canConfigure?: boolean;
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

/** Names each crash leftover the startup could not clean up and how it clears. */
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
  const limit =
    resources.options.maxConcurrentAcpSessions === 0
      ? t("settings.agents.resources.unlimited")
      : resources.options.maxConcurrentAcpSessions;
  return (
    <div className="space-y-2 text-sm">
      <p role="status" aria-live="polite" aria-atomic="true">
        {t("settings.agents.resources.summary", {
          active: resources.active.length,
          limit,
          waiting: resources.waiting.length,
        })}
      </p>
      <p className="text-muted-foreground">
        {t(`settings.agents.resources.source.${resources.limitSource}`)}
      </p>
      <p className="text-muted-foreground">
        {t("settings.agents.resources.ram", {
          available:
            resources.availableMemory === null
              ? "?"
              : Math.floor(resources.availableMemory),
          reserve: resources.options.minimumAvailableMemory,
        })}{" "}
        ·{" "}
        {t(
          `settings.agents.resources.${resources.options.memoryAwareScheduling ? "memoryEnabled" : "memoryDisabled"}`,
        )}
      </p>
      {resources.problem ? (
        <p role="alert" className="text-destructive">
          {t("settings.agents.resources.storage")}
        </p>
      ) : null}
      {resources.leftovers.length > 0 ? (
        <LeftoverNotice leftovers={resources.leftovers} />
      ) : null}
      <ul className="space-y-1">
        {resources.active.map((entry) => (
          <li key={entry.instanceId} className="break-words">
            {entry.provider} · {entry.runId ?? entry.instanceId} /{" "}
            {entry.stepId ?? "—"} ·{" "}
            {t(`settings.agents.resources.${entry.state}`)}
            {entry.isPaused
              ? ` · ${t("settings.agents.resources.paused")}`
              : ""}
          </li>
        ))}
        {resources.waiting.map((entry) => (
          <li
            key={entry.instanceId}
            className="break-words text-muted-foreground"
          >
            {entry.provider} · {entry.runId ?? entry.instanceId} /{" "}
            {entry.stepId ?? "—"} ·{" "}
            {t(`settings.agents.resources.${entry.reason}`)}
          </li>
        ))}
      </ul>
    </div>
  );
}
