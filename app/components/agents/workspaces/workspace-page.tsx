import { Folder, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { SettingsCard } from "@/app/components/settings/settings-layout";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { Dialog } from "@/app/components/ui/dialog";
import { HorizontalScrollArea } from "@/app/components/ui/horizontal-scroll-area";
import { useManagementPending } from "@/app/components/users/use-management-pending";

import { RemoteConnectionsCard } from "./remote/remote-connections-card";
import { RemoteWorkspaceRow } from "./remote/remote-workspace-row";
import { WorkspaceForm } from "./workspace-form";
import { WorkspaceRow } from "./workspace-row";

import type { AgentWorkspacePage } from "@/definition/AgentWorkspace";
import type { RemoteOverview } from "@/definition/RemoteConnection";
import type { WorkspaceSubject } from "./use-workspace-form";

const COLUMNS = [
  "nameProject",
  "location",
  "pathColumn",
  "githubColumn",
  "state",
];

/**
 * Shows the remote connections and the local and remote workspaces of
 * accessible projects; managers get the registration controls.
 */
export function WorkspacePage({
  page,
  remote,
}: {
  readonly page: AgentWorkspacePage;
  readonly remote: RemoteOverview;
}): React.ReactElement {
  const { t } = useTranslation();
  const isLoading = useManagementPending();
  const [selected, setSelected] = useState<WorkspaceSubject | "new">(null);
  const isOpen = selected !== null;
  function close(): void {
    setSelected(null);
  }
  const canRegister =
    page.canManage && (page.isConfigured || remote.choices.length > 0);
  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-2 pt-3 pb-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("workspaces.title")}</h1>
        {page.isAdministrator ? (
          <Link
            to="/settings/agents"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {t("navigation.agentManagement")}
          </Link>
        ) : null}
      </header>
      <RemoteConnectionsCard overview={remote} />
      <SettingsCard
        icon={<Folder className="size-5" />}
        title={t("workspaces.listTitle")}
        description={t("workspaces.description")}
        wrapHeader
        action={
          page.canManage ? (
            <Button
              size="sm"
              disabled={!canRegister}
              onClick={() => setSelected("new")}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t("workspaces.register")}
            </Button>
          ) : undefined
        }
      >
        {!page.isConfigured ? (
          <p role="status" className="mb-4 text-sm text-warning">
            {t(
              page.isAdministrator
                ? "workspaces.rootsMissingAdmin"
                : "workspaces.rootsMissing",
            )}
          </p>
        ) : null}
        <WorkspaceList
          page={page}
          remote={remote}
          isLoading={isLoading}
          onEdit={setSelected}
        />
      </SettingsCard>
      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        {isOpen ? (
          <WorkspaceForm
            subject={selected === "new" ? null : selected}
            projects={page.projects}
            canBrowse={page.canManage}
            connections={remote.choices}
            defaultLocation={page.isConfigured ? "local" : "remote"}
            onSaved={close}
          />
        ) : null}
      </Dialog>
    </div>
  );
}

function WorkspaceList(props: {
  readonly page: AgentWorkspacePage;
  readonly remote: RemoteOverview;
  readonly isLoading: boolean;
  readonly onEdit: (subject: WorkspaceSubject) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  if (props.isLoading)
    return (
      <div
        role="status"
        aria-label={t("workspaces.loading")}
        className="flex flex-col gap-4 py-2"
      >
        {[1, 2, 3].map((row) => (
          <div key={row} className="h-4 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    );
  if (
    props.page.workspaces.length === 0 &&
    props.remote.workspaces.length === 0
  )
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {t(
          props.page.canManage ? "workspaces.emptyManage" : "workspaces.empty",
        )}
      </p>
    );
  return <WorkspaceTable {...props} />;
}

function WorkspaceTable(props: {
  readonly page: AgentWorkspacePage;
  readonly remote: RemoteOverview;
  readonly onEdit: (subject: WorkspaceSubject) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { workspaces } = props.page;
  // Remote rows always offer a check; local rows only to those who manage them.
  const hasActions =
    props.remote.workspaces.length > 0 ||
    workspaces.some((workspace) => workspace.canManage);
  const columns = hasActions ? [...COLUMNS, "actions"] : COLUMNS;
  return (
    <HorizontalScrollArea>
      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col" className="px-4 py-3">
                {t(`workspaces.${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {workspaces.map((workspace) => (
            <WorkspaceRow
              key={workspace.id}
              workspace={workspace}
              hasActions={hasActions}
              onEdit={() => props.onEdit({ location: "local", workspace })}
            />
          ))}
          {props.remote.workspaces.map((workspace) => (
            <RemoteWorkspaceRow
              key={workspace.id}
              workspace={workspace}
              onEdit={() => props.onEdit({ location: "remote", workspace })}
            />
          ))}
        </tbody>
      </table>
    </HorizontalScrollArea>
  );
}
