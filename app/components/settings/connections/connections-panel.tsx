import { Plug } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { SettingsSectionHeader } from "@/app/components/settings/settings-layout";
import { useManagementPending } from "@/app/components/users/use-management-pending";
import { ConnectionConfirmation } from "./connection-confirmation";
import { PairingGuide } from "./pairing-guide";
import { PicaMobileCard } from "./pica-mobile-card";
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
  const actions = useConnectionsActions();
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
          {view.httpEndpoint ? (
            <div className="rounded-2xl border border-border p-4 text-sm">
              <p className="font-medium">{t("mcpHttp.endpoint")}</p>
              <code className="pages-selectable break-all">
                {view.httpEndpoint}
              </code>
              <p className="my-2 text-muted-foreground">{t("mcpHttp.hint")}</p>
              <a href="/mcp-login" className="underline">
                {t("mcpHttp.pair")}
              </a>
            </div>
          ) : null}
          <StdioConnectionsCard
            tokens={view.tokens}
            days={view.validityDays}
            pending={actions.pending}
            onGuide={() => setGuideOpen(true)}
            onAction={actions.choose}
            onValidity={actions.validity}
            endedRef={actions.endedRef}
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
