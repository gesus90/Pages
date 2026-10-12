import { Plug } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { SettingsSectionHeader } from "@/app/components/settings/settings-layout";
import { useManagementPending } from "@/app/components/users/use-management-pending";
import { ConnectionConfirmation } from "./connection-confirmation";
import { OAuthConnectionsCard } from "./oauth-connections-card";
import { PairingGuide } from "./pairing-guide";
import { StdioConnectionsCard } from "./stdio-connections-card";
import { useConnectionsActions } from "./use-connections-actions";

import type { McpConnectionsView } from "@/definition/McpConnections";

/** Composes the personal connections section using the established settings components. */
export function ConnectionsPanel({
  view,
}: {
  readonly view: McpConnectionsView;
}): React.ReactElement {
  const { t } = useTranslation();
  const [guideOpen, setGuideOpen] = useState(false);
  const actions = useConnectionsActions(view);
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
          <StdioConnectionsCard
            tokens={view.tokens}
            days={view.validityDays}
            pending={actions.pending}
            onGuide={() => setGuideOpen(true)}
            onAction={actions.choose}
            onValidity={actions.validity}
            endedRef={actions.endedRef}
          />
          <OAuthConnectionsCard
            oauth={view.oauth}
            pending={actions.pending}
            onAction={actions.choose}
            onDuration={actions.duration}
          />
        </div>
      )}
      {actions.error && !actions.selected ? (
        <p
          role="alert"
          className="pages-selectable mt-4 text-sm text-destructive"
        >
          {t("settings.connections.error.action")}
        </p>
      ) : null}
      <PairingGuide
        open={guideOpen}
        onOpenChange={setGuideOpen}
        origin={view.origin}
        version={view.packageVersion}
      />
      <ConnectionConfirmation
        action={actions.selected}
        pending={actions.pending}
        error={actions.error}
        onCancel={actions.cancel}
        onConfirm={actions.confirm}
      />
    </div>
  );
}
