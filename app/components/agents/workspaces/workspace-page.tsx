import { Folder, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { SettingsCard } from "@/app/components/settings/settings-layout";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { Dialog } from "@/app/components/ui/dialog";
import { HorizontalScrollArea } from "@/app/components/ui/horizontal-scroll-area";

import { WorkspaceForm } from "./workspace-form";
import { WorkspaceRow } from "./workspace-row";

import type {
  AgentWorkspacePage,
  AgentWorkspaceView,
} from "@/definition/AgentWorkspace";

/** Shows authorized local workspaces without setup, Git or execution actions. */
export function WorkspacePage({
  page,
}: {
  readonly page: AgentWorkspacePage;
}): React.ReactElement {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<AgentWorkspaceView | "new" | null>(
    null,
  );
  function close(): void {
    setSelected(null);
  }
  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-2 pt-3 pb-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("workspaces.title")}</h1>
        {page.canManage ? (
          <Link
            to="/settings/agents"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {t("navigation.agentManagement")}
          </Link>
        ) : null}
      </header>
      <SettingsCard
        icon={<Folder className="size-5" />}
        title={t("workspaces.title")}
        description={t("workspaces.description")}
        wrapHeader
        action={
          page.canManage ? (
            <Button
              size="sm"
              disabled={!page.isConfigured}
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
              page.canManage
                ? "workspaces.rootsMissingAdmin"
                : "workspaces.rootsMissing",
            )}
          </p>
        ) : null}
        {page.workspaces.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("workspaces.empty")}
          </p>
        ) : (
          <WorkspaceTable workspaces={page.workspaces} onEdit={setSelected} />
        )}
      </SettingsCard>
      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        {selected !== null ? (
          <WorkspaceForm
            workspace={selected === "new" ? null : selected}
            projects={page.projects}
            directory={page.directory}
            onSaved={close}
          />
        ) : null}
      </Dialog>
    </div>
  );
}

function WorkspaceTable(props: {
  readonly workspaces: readonly AgentWorkspaceView[];
  readonly onEdit: (workspace: AgentWorkspaceView) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <HorizontalScrollArea>
      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            {["name", "project", "path", "github", "state", "actions"].map(
              (column) => (
                <th key={column} scope="col" className="px-4 py-3">
                  {t(`workspaces.${column}`)}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {props.workspaces.map((workspace) => (
            <WorkspaceRow
              key={workspace.id}
              workspace={workspace}
              onEdit={() => props.onEdit(workspace)}
            />
          ))}
        </tbody>
      </table>
    </HorizontalScrollArea>
  );
}
