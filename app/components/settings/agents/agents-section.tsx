import { Bot } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SettingsSectionHeader } from "@/app/components/settings/settings-layout";
import { Dialog } from "@/app/components/ui/dialog";
import { useManagementPending } from "@/app/components/users/use-management-pending";

import { AgentAlert } from "./agent-alert";
import { AgentConfirmation } from "./agent-confirmation";
import { AgentConnectionPanel } from "./agent-connection-panel";
import { AgentConnectionsCard } from "./agent-connections-card";
import { AgentProfiles } from "./agent-profiles";
import { readBlockingAgents } from "./use-agent-actions";
import { useAgentManagement } from "./use-agent-management";
import { useCliLoginPolling } from "./use-cli-login-polling";

import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";
import type {
  AgentProfile,
  AgentProfileDirectory,
} from "@/definition/AgentProfile";
import type { AgentModelCatalog } from "@/definition/AgentModelCatalog";
import type { AgentAssignmentView } from "@/definition/AgentAssignment";
import type {
  AgentConnectionSummary,
  AgentAccessKind,
  CliToolLocations,
} from "@/definition/AgentConnection";
import type { AgentCommandHandler } from "./agent-row-menu";
import type { AgentAvailability } from "@/definition/AgentAvailability";
import type { AgentFilters } from "@/definition/AgentFilters";
import type { AgentTaskAssignment } from "@/definition/AgentUsage";

interface AgentsSectionProps {
  readonly workspaceChoices?: readonly AgentWorkspaceChoice[];
  readonly connections: readonly AgentConnectionSummary[];
  readonly cliTools: CliToolLocations;
  readonly catalogs?: Readonly<Record<string, AgentModelCatalog>>;
  readonly profiles?: readonly AgentProfile[];
  readonly profileDirectory?: AgentProfileDirectory;
  readonly assignments?: readonly AgentAssignmentView[];
  readonly availability?: Readonly<Record<string, AgentAvailability>>;
  readonly filters?: AgentFilters;
  readonly projects?: readonly { readonly id: string; readonly name: string }[];
  readonly taskAssignments?: Readonly<
    Record<string, readonly AgentTaskAssignment[]>
  >;
}

/** Manages first-pass connection tables and panels without automatic provider checks. */
export function AgentsSection({
  connections,
  cliTools,
  catalogs = {},
  assignments = [],
  profiles = [],
  profileDirectory = { persons: [], groups: [], departments: [] },
  availability,
  filters,
  projects,
  workspaceChoices,
  taskAssignments,
}: AgentsSectionProps): React.ReactElement {
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
  const visibleConnections = withLoginSessions(connections, sessions);
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
        <AgentAlert
          message={t(`settings.agents.error.${actions.error}`)}
          details={readBlockingAgents(actions.result)}
        />
      ) : null}
      <AgentProfiles
        profiles={profiles}
        directory={profileDirectory}
        connections={connections}
        catalogs={catalogs}
        availability={availability}
        filters={filters}
        projects={projects}
        workspaceChoices={workspaceChoices}
        taskAssignments={taskAssignments}
      />
      <LegacyAgentNotice assignments={assignments} />
      <AgentConnectionTables
        isLoading={isLoading}
        connections={visibleConnections}
        cliTools={cliTools}
        disabled={actions.isPending}
        onAdd={(kind) => select({ kind })}
        onEdit={edit}
        onCommand={command}
      />
      <Dialog open={selection !== null} onOpenChange={() => setSelection(null)}>
        {selection ? (
          <AgentConnectionPanel
            key={selection.id ?? selection.kind}
            kind={selection.kind}
            connection={selected}
            directory={profileDirectory}
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

function withLoginSessions(
  connections: readonly AgentConnectionSummary[],
  sessions: ReturnType<typeof useCliLoginPolling>,
): readonly AgentConnectionSummary[] {
  return connections.map((connection) => {
    const session = sessions[connection.id];
    return connection.cli && session && !session.hasError
      ? { ...connection, cli: { ...connection.cli, login: session.login } }
      : connection;
  });
}

function LegacyAgentNotice(props: {
  readonly assignments: readonly AgentAssignmentView[];
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (!props.assignments.some((assignment) => assignment.function === "skills"))
    return null;
  return (
    <p className="rounded-xl bg-warning-subtle px-4 py-2.5 text-sm text-warning">
      {t("settings.agents.definition.legacySkills")}
    </p>
  );
}

function AgentConnectionTables(props: {
  readonly isLoading: boolean;
  readonly connections: readonly AgentConnectionSummary[];
  readonly cliTools: CliToolLocations;
  readonly disabled: boolean;
  readonly onAdd: (kind: AgentAccessKind) => void;
  readonly onEdit: (connection: AgentConnectionSummary) => void;
  readonly onCommand: AgentCommandHandler;
}): React.ReactElement {
  const { t } = useTranslation();
  if (props.isLoading)
    return (
      <div
        role="status"
        aria-label={t("settings.agents.loading")}
        className="h-40 animate-pulse rounded-2xl bg-muted"
      />
    );
  return (
    <>
      {(["api_key", "cli_account"] as const).map((kind) => (
        <AgentConnectionsCard
          key={kind}
          kind={kind}
          connections={props.connections.filter(
            (connection) => connection.accessKind === kind,
          )}
          cliTools={props.cliTools}
          disabled={props.disabled}
          onAdd={props.onAdd}
          onEdit={props.onEdit}
          onCommand={props.onCommand}
        />
      ))}
    </>
  );
}
