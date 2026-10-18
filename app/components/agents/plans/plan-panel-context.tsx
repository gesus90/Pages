import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { Button } from "@/app/components/ui/button";

import type { AgentPlanPage } from "@/definition/AgentPlan";
import type { usePlanEditor } from "./use-plan-editor";

/** Context selection changes the existing draft; Save uses its normal revision-protected path. */
export function PlanPanelContext({
  page,
  editor,
}: {
  readonly page: AgentPlanPage;
  readonly editor: ReturnType<typeof usePlanEditor>;
}): React.ReactElement {
  const { t } = useTranslation();
  const workspace = page.workspaces.find(
    (entry) => entry.id === editor.draft.workspaceId,
  );
  const projects = [
    ...new Map(
      page.workspaces.map((entry) => [
        entry.projectId,
        { value: entry.projectId, label: entry.projectName },
      ]),
    ).values(),
  ];
  const workspaces = page.workspaces.filter(
    (entry) => entry.projectId === workspace?.projectId,
  );
  const disabled = !editor.canEdit || editor.isPending;
  function projectChanged(id: string): void {
    const first = page.workspaces.find((entry) => entry.projectId === id);
    if (first) editor.changeContext(first);
  }
  function workspaceChanged(id: string): void {
    const next = page.workspaces.find((entry) => entry.id === id);
    if (next) editor.changeContext(next);
  }
  return (
    <div
      id="plan-panel-context"
      className="space-y-4 border-t border-border px-4 py-4"
    >
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <label className="grid min-w-0 gap-1.5 text-xs font-medium">
          {t("workspaces.project")}
          <Select
            ariaLabel={t("workspaces.project")}
            value={workspace?.projectId ?? ""}
            options={projects}
            onValueChange={projectChanged}
            disabled={disabled}
            className="w-full min-w-0 [&>span]:truncate"
          />
          <span className="text-xs font-normal break-words text-muted-foreground">
            {workspace?.projectName}
          </span>
        </label>
        <label className="grid min-w-0 gap-1.5 text-xs font-medium">
          {t("plans.panel.workspace")}
          <Select
            ariaLabel={t("plans.panel.workspace")}
            value={editor.draft.workspaceId}
            options={workspaces.map((entry) => ({
              value: entry.id,
              label: entry.name,
            }))}
            onValueChange={workspaceChanged}
            disabled={disabled}
            className="w-full min-w-0 [&>span]:truncate"
          />
          <span className="text-xs font-normal break-words text-muted-foreground">
            {workspace?.name}
          </span>
        </label>
        <PlanPanelManagement page={page} editor={editor} />
      </div>
      <p className="text-xs text-muted-foreground">
        {t("plans.panel.draftRevision", {
          revision: editor.draft.revision ?? 0,
        })}
      </p>
      <p className="text-xs text-muted-foreground">
        {t("plans.panel.contextHint")}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          onClick={editor.save}
          disabled={disabled || !editor.isDirty || !editor.draft.workspaceId}
        >
          {t("plans.panel.save")}
        </Button>
        <Link
          className="rounded text-sm text-primary-text underline focus-visible:outline-2 focus-visible:outline-ring"
          to="/agents/workspaces"
        >
          {t("plans.panel.manageWorkspaces")}
        </Link>
      </div>
    </div>
  );
}

function PlanPanelManagement({
  page,
  editor,
}: {
  readonly page: AgentPlanPage;
  readonly editor: ReturnType<typeof usePlanEditor>;
}): React.ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const disabled = !editor.canEdit || editor.isPending;
  return (
    <>
      {" "}
      <label className="grid min-w-0 gap-1.5 text-xs font-medium">
        {t("plans.panel.openPlan")}
        <Select
          ariaLabel={t("plans.panel.openPlan")}
          value={page.selected?.id ?? ""}
          options={page.plans.map((plan) => ({
            value: plan.id,
            label: plan.name,
          }))}
          onValueChange={(id) => {
            void navigate(`/agents/plans?planId=${encodeURIComponent(id)}`);
          }}
          className="w-full min-w-0 [&>span]:truncate"
        />
      </label>
      <label className="grid min-w-0 gap-1.5 text-xs font-medium">
        {t("plans.panel.name")}
        <Input
          value={editor.draft.name}
          disabled={disabled}
          maxLength={120}
          onChange={(event) => editor.rename(event.target.value)}
        />
      </label>
    </>
  );
}
