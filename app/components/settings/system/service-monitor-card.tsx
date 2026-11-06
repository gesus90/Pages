import { Activity } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { SettingsCard } from "@/app/components/settings/settings-layout";

import type { ServiceMonitorStatus } from "@/definition/ServiceMonitor";

/** Polls persisted supervisor warnings, including incidents that happened while the API was down. */
export function ServiceMonitorCard(): React.ReactElement {
  const { t } = useTranslation();
  const { data: status, load } = useFetcher<ServiceMonitorStatus>();
  useEffect(() => {
    void load("/settings-api/services");
    const timer = setInterval(
      () => void load("/settings-api/services"),
      15_000,
    );
    return () => clearInterval(timer);
  }, [load]);

  return (
    <SettingsCard
      title={t("settings.serviceMonitor.title")}
      description={t("settings.serviceMonitor.description")}
      icon={<Activity className="size-4" aria-hidden="true" />}
    >
      <div className="text-sm" aria-live="polite">
        {!status ? <p>{t("settings.serviceMonitor.loading")}</p> : null}
        {status && status.state !== "ok" ? (
          <p role="alert" className="text-warning">
            {t("settings.serviceMonitor.unavailable")}
          </p>
        ) : null}
        {status?.state === "ok" && status.warnings.length === 0 ? (
          <p className="text-muted-foreground">
            {t("settings.serviceMonitor.healthy")}
          </p>
        ) : null}
        {status?.warnings.map((warning) => (
          <p
            key={warning.unit}
            role="alert"
            className="mt-2 break-words text-warning"
          >
            {t("settings.serviceMonitor.warning", {
              unit: warning.unit,
              count: warning.count,
              time: new Date(warning.detectedAt).toLocaleString(),
            })}
          </p>
        ))}
      </div>
    </SettingsCard>
  );
}
