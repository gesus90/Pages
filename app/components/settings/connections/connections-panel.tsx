import { Plug } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SettingsSectionHeader } from "@/app/components/settings/settings-layout";
import { useManagementPending } from "@/app/components/users/use-management-pending";
import { McpDevicesCard } from "./mcp-devices-card";
import { PicaMobileCard } from "./pica-mobile-card";

import type { ConnectionsView } from "@/definition/Connections";

/** Composes the connections section using the established settings components. */
export function ConnectionsPanel({
  view,
}: {
  readonly view: ConnectionsView;
}): React.ReactElement {
  const { t } = useTranslation();
  const loading = useManagementPending();
  return (
    <div className="w-full max-w-6xl">
      <SettingsSectionHeader
        icon={<Plug className="size-4" aria-hidden="true" />}
        title={t("settings.connections.title")}
        description={t("settings.connections.description")}
      />
      {loading ? (
        <div
          aria-busy="true"
          aria-label={t("settings.connections.loading")}
          className="h-48 animate-pulse rounded-2xl bg-muted/40"
        />
      ) : (
        <div className="space-y-4">
          {view.picaMobile ? (
            <PicaMobileCard settings={view.picaMobile} />
          ) : null}
          <McpDevicesCard devices={view.mcpDevices ?? []} />
        </div>
      )}
    </div>
  );
}
