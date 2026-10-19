import { useEffect, useId, useRef } from "react";
import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { Button } from "@/app/components/ui/button";

import { isPlanNameListed, isPlanNameRefused } from "./plan-name-issue";

import type { AgentPlanPage } from "@/definition/AgentPlan";
import type { usePlanEditor } from "./use-plan-editor";

/**
 * Whether the person may move the plan to another project.
 *
 * @remarks
 * Every team member chooses another workspace of the plan's project, but the
 * server lets only the owner move the plan to another project, so that
 * selection is offered to the owner alone.
 */
function canChangeProject(page: AgentPlanPage): boolean {
  return !page.selected || page.selected.ownerId === page.userId;
}

/** The plan the last save created, which the editor of a new plan still shows as a draft. */
function savedPlanId(
  editor: ReturnType<typeof usePlanEditor>,
): string | undefined {
  const result = editor.command.data;
  return result?.ok ? result.planId : undefined;
}

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
  const isProjectFixed = disabled || !canChangeProject(page);
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
            disabled={isProjectFixed}
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

      <PlanPanelTeam page={page} />
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
  const inputId = useId();
  const messageId = useId();
  const input = useRef<HTMLInputElement>(null);
  const disabled = !editor.canEdit || editor.isPending;
  const isRefused = isPlanNameRefused(
    editor.command.data,
    editor.submittedName,
    editor.draft.name,
  );
  const isTaken =
    isRefused || isPlanNameListed(page, editor.draft, savedPlanId(editor));
  // A refused name is fixed in its field, so the field takes the focus and scrolls into view.
  useEffect(() => {
    if (isRefused) input.current?.focus();
  }, [isRefused]);
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
      <div className="grid min-w-0 gap-1.5 text-xs font-medium">
        <label htmlFor={inputId}>{t("plans.panel.name")}</label>
        <Input
          id={inputId}
          ref={input}
          value={editor.draft.name}
          disabled={disabled}
          maxLength={120}
          aria-invalid={isTaken}
          aria-describedby={isTaken ? messageId : undefined}
          className="aria-invalid:ring-2 aria-invalid:ring-destructive/60"
          onChange={(event) => editor.rename(event.target.value)}
        />
        {isTaken ? (
          <span
            id={messageId}
            role="alert"
            className="text-xs font-normal text-destructive"
          >
            {t("settings.agents.error.plan_name_taken")}
          </span>
        ) : null}
      </div>
    </>
  );
}

/** Says, without a way to change it, which team shares the plan and who moves it to another project. */
function PlanPanelTeam({
  page,
}: {
  readonly page: AgentPlanPage;
}): React.ReactElement {
  const { t } = useTranslation();
  const departmentId = page.selected
    ? (page.selected.departmentId ?? null)
    : (page.teamDepartmentId ?? null);
  const department = page.directory.departments.find(
    (entry) => entry.id === departmentId,
  );
  let text = t("plans.panel.team.none");
  if (departmentId !== null)
    text = t(
      page.selected ? "plans.panel.team.shared" : "plans.panel.team.new",
      {
        name: department?.name ?? t("plans.panel.team.unknown"),
      },
    );
  return (
    <>
      <p className="text-xs wrap-anywhere text-muted-foreground" data-plan-team>
        {text}
      </p>
      {page.selected?.canEdit && !canChangeProject(page) ? (
        <p className="text-xs text-muted-foreground">
          {t("plans.panel.projectOwnerOnly")}
        </p>
      ) : null}
    </>
  );
}
