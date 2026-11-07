import { MonitorSmartphone } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useRegionFormatter } from "@/app/components/common/region-provider";
import { SettingsCard } from "@/app/components/settings/settings-layout";

import { McpDeviceRevokeDialog } from "./mcp-device-revoke-dialog";

import type { McpDeviceView } from "@/definition/McpDevice";

/** Lists the machines paired with the account, each with its revocation. */
export function McpDevicesCard({
  devices,
}: {
  readonly devices: readonly McpDeviceView[];
}): React.ReactElement {
  const { t } = useTranslation();
  const { formatDateTime } = useRegionFormatter();

  return (
    <SettingsCard
      icon={<MonitorSmartphone className="size-4" />}
      title={t("settings.connections.mcpDevices.title")}
      description={t("settings.connections.mcpDevices.description")}
    >
      {devices.length === 0 ? (
        <p className="pages-selectable text-sm text-muted-foreground">
          {t("settings.connections.mcpDevices.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {devices.map((device) => (
            <li
              className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              key={device.id}
            >
              <div className="min-w-0">
                <p className="pages-selectable text-sm font-semibold break-words text-foreground">
                  {device.name}
                </p>
                <p className="pages-selectable mt-0.5 text-xs text-muted-foreground">
                  {t("settings.connections.mcpDevices.version", {
                    version: device.clientVersion,
                  })}
                  {" · "}
                  {t("settings.connections.mcpDevices.pairedAt", {
                    date: formatDateTime(device.pairedAt),
                  })}
                  {" · "}
                  {device.lastUsedAt === null
                    ? t("settings.connections.mcpDevices.neverUsed")
                    : t("settings.connections.mcpDevices.lastUsed", {
                        date: formatDateTime(device.lastUsedAt),
                      })}
                </p>
              </div>
              <McpDeviceRevokeDialog device={device} />
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}
