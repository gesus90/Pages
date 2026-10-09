import { Bot } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SettingsSectionHeader } from "@/app/components/settings/settings-layout";
import { Dialog } from "@/app/components/ui/dialog";
import { useManagementPending } from "@/app/components/users/use-management-pending";

import { AgentAlert } from "./agent-alert";
import { AgentConfirmation } from "./agent-confirmation";
import { AgentConnectionPanel } from "./agent-connection-panel";
import { AgentConnectionsCard } from "./agent-connections-card";
import { useAgentManagement } from "./use-agent-management";
import { useCliLoginPolling } from "./use-cli-login-polling";

import type { AgentModelCatalog } from "@/definition/AgentModelCatalog";
import type {
  AgentConnectionSummary,
  CliToolLocations,
} from "@/definition/AgentConnection";

/** Manages first-pass connection tables and panels without automatic provider checks. */
export function AgentsSection({
  connections,
  cliTools,
  catalogs = {},
}: {
  readonly connections: readonly AgentConnectionSummary[];
  readonly cliTools: CliToolLocations;
  readonly catalogs?: Readonly<Record<string, AgentModelCatalog>>;
}): React.ReactElement {
  const { t } = useTranslation();
  const {
    selection,
    confirmation,
    actions,
    setSelection,
    select,
    edit,
    command,
    confirm,
    closeConfirmation,
    returnFocus,
  } = useAgentManagement();
  const sessions = useCliLoginPolling(connections);
  const isLoading = useManagementPending();
  const visibleConnections = connections.map((connection) => {
    const session = sessions[connection.id];
    return connection.cli && session && !session.hasError
      ? { ...connection, cli: { ...connection.cli, login: session.login } }
      : connection;
  });
  const selected = visibleConnections.find(
    (connection) => connection.id === selection?.id,
  );
  return (
    <div className="min-w-0 space-y-4">
      <SettingsSectionHeader
        icon={<Bot className="size-4" aria-hidden="true" />}
        title={t("settings.agents.title")}
        description={t("settings.agents.description")}
      />
      {actions.error && !selection ? (
        <AgentAlert message={t(`settings.agents.error.${actions.error}`)} />
      ) : null}
      {isLoading ? (
        <div
          role="status"
          aria-label={t("settings.agents.loading")}
          className="h-40 animate-pulse rounded-2xl bg-muted"
        />
      ) : (
        (["api_key", "cli_account"] as const).map((kind) => (
          <AgentConnectionsCard
            key={kind}
            kind={kind}
            connections={visibleConnections.filter(
              (connection) => connection.accessKind === kind,
            )}
            cliTools={cliTools}
            disabled={actions.isPending}
            onAdd={(accessKind) => select({ kind: accessKind })}
            onEdit={edit}
            onCommand={command}
          />
        ))
      )}
      <Dialog open={selection !== null} onOpenChange={() => setSelection(null)}>
        {selection ? (
          <AgentConnectionPanel
            key={selection.id ?? selection.kind}
            kind={selection.kind}
            connection={selected}
            catalog={selected ? catalogs[selected.id] : undefined}
            actions={actions}
            hasPollError={Boolean(selected && sessions[selected.id]?.hasError)}
            onSaved={(id) => setSelection({ kind: selection.kind, id })}
            onCommand={command}
            onReturnFocus={returnFocus}
          />
        ) : null}
      </Dialog>
      {confirmation ? (
        <AgentConfirmation
          request={confirmation}
          onClose={closeConfirmation}
          onConfirm={confirm}
        />
      ) : null}
    </div>
  );
}
