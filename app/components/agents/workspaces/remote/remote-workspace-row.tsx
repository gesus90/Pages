import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { useRegionFormat } from "@/app/components/common/region-provider";
import { Button } from "@/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { formatDateTime } from "@/app/lib/region-format";

import { WorkspaceNameCell } from "../workspace-row";
import { RemoteActionMessage } from "./remote-action-message";
import { RemoteWorkspaceDelete } from "./remote-workspace-delete";
import { RemoteConsolePanel } from "./console/remote-console-panel";

import type {
  RemoteActionResult,
  RemoteWorkspaceReason,
  RemoteWorkspaceView,
} from "@/definition/RemoteConnection";

const OWN_REASONS: ReadonlySet<RemoteWorkspaceReason> = new Set([
  "project_unavailable",
  "github_missing",
  "connection_blocked",
  "unchecked",
]);

function reasonKey(reason: RemoteWorkspaceReason): string {
  return OWN_REASONS.has(reason)
    ? `remote.workspace.reason.${reason}`
    : `remote.failure.${reason}`;
}

/** Usability with the time of the last directory check, marked when the allowed directories changed since. */
function RemoteWorkspaceState(props: {
  readonly workspace: RemoteWorkspaceView;
  readonly result: RemoteActionResult | undefined;
}): React.ReactElement {
  const { t } = useTranslation();
  const region = useRegionFormat();
  const { workspace } = props;
  return (
    <div className="text-sm">
      <p className={workspace.isUsable ? "text-success" : "text-warning"}>
        {workspace.reason
          ? t(reasonKey(workspace.reason))
          : t("workspaces.ready")}
      </p>
      {workspace.check ? (
        <p className="text-xs text-muted-foreground">
          {t("remote.status.checkedAt", {
            time: formatDateTime(workspace.check.checkedAt, region),
          })}
        </p>
      ) : null}
      {workspace.isCheckOutdated ? (
        <p className="text-xs text-warning">
          {t("remote.workspace.checkOutdated")}
        </p>
      ) : null}
      <RemoteActionMessage result={props.result} />
    </div>
  );
}

/** Checking is open to everyone who may use the profile; edit and removal need project responsibility. */
function RemoteWorkspaceActions(props: {
  readonly workspace: RemoteWorkspaceView;
  readonly onCheck: () => void;
  readonly onEdit: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const [isDeleting, setDeleting] = useState(false);
  const [isConsoleOpen, setConsoleOpen] = useState(false);
  const { workspace } = props;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon-sm"
            variant="ghost"
            data-console-open={isConsoleOpen}
            aria-label={t("settings.agents.actionsFor", {
              name: workspace.name,
            })}
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {workspace.canOpenConsole ? (
            <DropdownMenuItem onSelect={() => setConsoleOpen(true)}>
              {t("remote.console.action")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={props.onCheck}>
            {t("remote.workspace.check")}
          </DropdownMenuItem>
          {workspace.canManage ? (
            <>
              <DropdownMenuItem onSelect={props.onEdit}>
                {t("settings.agents.edit")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onSelect={() => setDeleting(true)}
              >
                {t("workspaces.unregister")}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {isDeleting ? (
        <RemoteWorkspaceDelete
          workspace={workspace}
          onClose={() => setDeleting(false)}
        />
      ) : null}
      {isConsoleOpen ? (
        <RemoteConsolePanel
          workspace={workspace}
          onClose={() => setConsoleOpen(false)}
        />
      ) : null}
    </>
  );
}

/** A remote profile: its connection is the place of execution; several profiles of one connection stay separate rows. */
export function RemoteWorkspaceRow(props: {
  readonly workspace: RemoteWorkspaceView;
  readonly onEdit: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<RemoteActionResult>();
  const { workspace } = props;
  function handleCheck(): void {
    void fetcher.submit(
      { intent: "check-remote-workspace", workspaceId: workspace.id },
      { method: "post", action: "/agents/workspaces/remote" },
    );
  }
  return (
    <tr className="align-top focus-within:bg-primary-subtle has-[[data-state=open]]:bg-primary-subtle has-[[data-console-open=true]]:bg-primary-subtle">
      <WorkspaceNameCell
        name={workspace.name}
        projectName={workspace.projectName}
      />
      <td className="px-4 py-3">
        {t("remote.workspace.remoteLocation", {
          name: workspace.connectionName,
        })}
      </td>
      <td className="pages-selectable max-w-80 px-4 py-3 font-mono break-all">
        {workspace.path}
      </td>
      <td className="pages-selectable max-w-64 px-4 py-3 break-all">
        {workspace.github?.repoUrl ?? t("workspaces.noGitHub")}
      </td>
      <td className="max-w-72 px-4 py-3">
        {fetcher.state === "idle" ? (
          <RemoteWorkspaceState workspace={workspace} result={fetcher.data} />
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {t("remote.status.checking")}
          </p>
        )}
      </td>
      <td className="px-4 py-3">
        <RemoteWorkspaceActions
          workspace={workspace}
          onCheck={handleCheck}
          onEdit={props.onEdit}
        />
      </td>
    </tr>
  );
}
