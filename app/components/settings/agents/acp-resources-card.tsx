import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import type { AcpResourceSnapshot } from "@/definition/AcpResource";

/** Polls the authorized resource endpoint without starting native processes or provider checks. */
export function AcpResourcesCard(): React.ReactElement {
  const { t } = useTranslation();
  const { data: resources, load } = useFetcher<
    AcpResourceSnapshot | { error: string }
  >();
  useEffect(() => {
    void load("/agent-api/resources");
    const timer = setInterval(() => {
      void load("/agent-api/resources");
    }, 5000);
    return () => clearInterval(timer);
  }, [load]);
  return (
    <section
      className="space-y-3 rounded-lg border border-border bg-surface p-4"
      aria-label={t("settings.agents.resources.title")}
    >
      <h2 className="font-semibold">{t("settings.agents.resources.title")}</h2>
      {resources && "active" in resources ? (
        <ResourceDetails resources={resources} />
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("settings.agents.resources.unavailable")}
        </p>
      )}
    </section>
  );
}

function ResourceDetails({
  resources,
}: {
  readonly resources: AcpResourceSnapshot;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="space-y-2 text-sm">
      <p>
        {t("settings.agents.resources.summary", {
          active: resources.active.length,
          limit: resources.options.maxConcurrentAcpSessions,
          waiting: resources.waiting.length,
        })}
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
