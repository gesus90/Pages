import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SettingsCard } from "@/app/components/settings/settings-layout";
import { Select } from "@/app/components/ui/select";
import { OAuthConnectionsTable } from "./oauth-connections-table";

import type { McpConnectionsView } from "@/definition/McpConnections";
import type { ConnectionAction } from "./connection-action";

/** Exposes the existing HTTP grant duration and revocation flow without changing its protocol. */
export function OAuthConnectionsCard({
  oauth,
  pending,
  onDuration,
  onAction,
}: {
  readonly oauth: McpConnectionsView["oauth"];
  readonly pending: boolean;
  readonly onDuration: (duration: string) => void;
  readonly onAction: (action: ConnectionAction) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const current =
    oauth.durationSeconds === null
      ? "unlimited"
      : String(oauth.durationSeconds);
  const options = [
    {
      value: "86400",
      label: t("settings.connections.oauth.days", { count: 1 }),
    },
    {
      value: "604800",
      label: t("settings.connections.oauth.days", { count: 7 }),
    },
    {
      value: "2592000",
      label: t("settings.connections.oauth.days", { count: 30 }),
    },
    {
      value: "7776000",
      label: t("settings.connections.oauth.days", { count: 90 }),
    },
    { value: "unlimited", label: t("mcpDuration.unlimited") },
  ];
  if (!options.some((entry) => entry.value === current))
    options.push({
      value: current,
      label: t("mcpDuration.current", {
        duration: `${oauth.durationSeconds} s`,
      }),
    });
  return (
    <SettingsCard
      icon={<ShieldCheck className="size-4" />}
      title={t("settings.connections.oauth.title")}
      description={t("settings.connections.oauth.description")}
    >
      <div className="space-y-2">
        <label htmlFor="oauth-duration" className="block text-sm font-medium">
          {t("settings.connections.oauth.duration")}
        </label>
        <Select
          id="oauth-duration"
          size="default"
          value={current}
          options={options}
          onValueChange={onDuration}
          disabled={pending}
        />
        <p className="text-xs text-muted-foreground">
          {t("settings.connections.oauth.durationHint")}
        </p>
      </div>
      {oauth.grants.length === 0 ? (
        <p className="mt-5 text-sm text-muted-foreground">
          {t("settings.connections.oauth.empty")}
        </p>
      ) : (
        <OAuthConnectionsTable
          grants={oauth.grants}
          pending={pending}
          onAction={onAction}
        />
      )}
    </SettingsCard>
  );
}
