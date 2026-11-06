import { Gauge } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ServiceLightBadge } from "@/app/components/common/service-status-light";
import { SettingsCard } from "@/app/components/settings/settings-layout";
import { readServiceStatusDetails } from "@/app/lib/service-status";

import type { ServiceStatusReading } from "@/app/lib/service-status";
import type { ServiceState } from "@/definition/ServiceStatus";

/** The details are read again this often, so a lost admin right hides them soon. */
const POLL_INTERVAL_MS = 5000;

/** Polls the detailed status; every answer replaces the previous one. */
function useServiceStatusDetails(): ServiceStatusReading | null {
  const [reading, setReading] = useState<ServiceStatusReading | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    async function poll(): Promise<void> {
      const next = await readServiceStatusDetails(controller.signal);
      if (!controller.signal.aborted) setReading(next);
    }
    void poll();
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, []);
  return reading;
}

function ServiceRow({
  service,
}: {
  readonly service: ServiceState;
}): React.ReactElement {
  const { t } = useTranslation();

  return (
    <tr className="border-t border-border/70">
      <th scope="row" className="py-2 pr-3 text-left font-medium break-all">
        {service.name}
      </th>
      <td className="py-2 pr-3" data-service-state={service.state}>
        {t(`serviceStatus.state.${service.state}`)}
      </td>
      <td className="py-2 pr-3 text-muted-foreground">
        {service.lastStart === null
          ? t("serviceStatus.neverStarted")
          : new Date(service.lastStart).toLocaleString()}
      </td>
      <td className="py-2 text-right tabular-nums">{service.restarts}</td>
    </tr>
  );
}

function ServiceTable({
  services,
}: {
  readonly services: readonly ServiceState[];
}): React.ReactElement {
  const { t } = useTranslation();

  return (
    <table className="mt-3 w-full text-sm">
      <thead className="text-xs text-muted-foreground">
        <tr>
          <th scope="col" className="pb-1 text-left font-medium">
            {t("serviceStatus.column.name")}
          </th>
          <th scope="col" className="pb-1 text-left font-medium">
            {t("serviceStatus.column.state")}
          </th>
          <th scope="col" className="pb-1 text-left font-medium">
            {t("serviceStatus.column.lastStart")}
          </th>
          <th scope="col" className="pb-1 text-right font-medium">
            {t("serviceStatus.column.restarts")}
          </th>
        </tr>
      </thead>
      <tbody>
        {services.map((service) => (
          <ServiceRow key={service.name} service={service} />
        ))}
      </tbody>
    </table>
  );
}

function ServiceStatusContent({
  reading,
}: {
  readonly reading: ServiceStatusReading | null;
}): React.ReactElement {
  const { t } = useTranslation();
  if (reading === null)
    return (
      <p className="text-muted-foreground">{t("serviceStatus.loading")}</p>
    );
  if (reading.kind === "unreachable")
    return <p className="text-warning">{t("serviceStatus.unreachable")}</p>;
  if (reading.kind === "granted")
    return (
      <>
        <ServiceLightBadge light={reading.details.light} />
        <ServiceTable services={reading.details.services} />
      </>
    );
  return (
    <>
      <ServiceLightBadge light={reading.light} />
      <p className="mt-3 text-muted-foreground">
        {t(`serviceStatus.${reading.kind}`)}
      </p>
    </>
  );
}

/**
 * Shows each service of the platform with state, last start and restarts (PAGE-238).
 *
 * @remarks
 * Read in the browser from `pages-core`, which reads the systemd manager and
 * asks the API whether the session holds the admin mode, on every request.
 * When the API cannot confirm it, for instance because the API is stopped,
 * the details disappear with the next answer and only the light remains.
 */
export function ServiceStatusCard(): React.ReactElement {
  const { t } = useTranslation();
  const reading = useServiceStatusDetails();

  return (
    <SettingsCard
      title={t("serviceStatus.title")}
      description={t("serviceStatus.description")}
      icon={<Gauge className="size-4" aria-hidden="true" />}
    >
      <div className="text-sm" aria-live="polite">
        <ServiceStatusContent reading={reading} />
      </div>
    </SettingsCard>
  );
}
