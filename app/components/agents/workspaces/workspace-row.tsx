import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";

import { WorkspaceDelete } from "./workspace-delete";

import type { AgentWorkspaceView } from "@/definition/AgentWorkspace";

/** Keeps path failures visible and registration administration separate from usage. */
export function WorkspaceRow(props: {
  readonly workspace: AgentWorkspaceView;
  readonly onEdit: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const [isDeleting, setDeleting] = useState(false);
  const { workspace } = props;
  return (
    <tr>
      <th scope="row" className="pages-selectable px-4 py-3 font-medium">
        {workspace.name}
      </th>
      <td className="pages-selectable px-4 py-3">{workspace.projectName}</td>
      <td className="pages-selectable max-w-80 px-4 py-3 font-mono break-all">
        {workspace.path}
      </td>
      <td className="pages-selectable max-w-64 px-4 py-3 break-all">
        {workspace.github?.repoUrl ?? t("workspaces.noGitHub")}
      </td>
      <td className="px-4 py-3">
        <span className={workspace.isUsable ? "text-success" : "text-warning"}>
          {workspace.reason
            ? t(`settings.agents.error.${workspace.reason}`)
            : t("workspaces.ready")}
        </span>
      </td>
      <td className="px-4 py-3">
        {workspace.canManage ? (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t("settings.agents.actionsFor", {
                    name: workspace.name,
                  })}
                >
                  <MoreHorizontal className="size-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={props.onEdit}>
                  {t("settings.agents.edit")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive"
                  onSelect={() => setDeleting(true)}
                >
                  {t("workspaces.unregister")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {isDeleting ? (
              <WorkspaceDelete
                workspace={workspace}
                onClose={() => setDeleting(false)}
              />
            ) : null}
          </>
        ) : null}
      </td>
    </tr>
  );
}
