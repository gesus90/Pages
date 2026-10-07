import { Server } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SettingsSectionHeader } from "@/app/components/settings/settings-layout";
import { InstanceCard } from "@/app/components/settings/system/instance-card";
import { ServerCard } from "@/app/components/settings/system/server-card";
import { StatusCard } from "@/app/components/settings/system/status-card";

import type { ServerStatus } from "@/backend/service/ServerSettingsService";
import type { InstanceBranding } from "@/definition/Instance";

interface SystemSectionProps {
  /** Port stored in the configuration for the next start. */
  readonly port: number;
  readonly branding: InstanceBranding;
  readonly status: ServerStatus;
}

/**
 * Renders the system settings that administrators see.
 *
 * @remarks
 * Company name and logo are stored in the database and apply at once. The
 * port is stored in the configuration file and applies after Pages restarts.
 * Version, database file, and start time are shown and cannot be changed.
 */
export function SystemSection({
  port,
  branding,
  status,
}: SystemSectionProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <section>
      <SettingsSectionHeader
        description={t("settings.system.description")}
        icon={<Server className="size-4" aria-hidden="true" />}
        title={t("settings.system.title")}
      />
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <div className="flex flex-col gap-4">
          <InstanceCard branding={branding} />
        </div>
        <div className="flex flex-col gap-4">
          <StatusCard status={status} />
          <ServerCard port={port} />
        </div>
      </div>
    </section>
  );
}
