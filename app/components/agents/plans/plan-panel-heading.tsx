import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { isPlanEditLocked } from "@/definition/AgentPlanRunState";
import { canRunPlan } from "@/definition/AgentPlanTeam";

import { Button } from "@/app/components/ui/button";

import { PlanOneShotBadge, PlanOneShotNotice } from "./plan-one-shot-notice";
import { PlanAccessBadges } from "./plan-access-badges";
import { PlanPanelMenu } from "./plan-panel-menu";
import { PlanRunActions } from "./plan-run-actions";
import {
  PlanResumeBlockButton,
  PlanResumeBlockNotice,
} from "./plan-resume-block-notice";

import type { TFunction } from "i18next";
import type { AgentPlanPage } from "@/definition/AgentPlan";
import type {
  AgentPlanControl,
  AgentPlanResumeAction,
} from "@/definition/AgentPlanControl";
import type { PlanManagementDialog } from "./plan-management/use-plan-management";
import type { PlanRunIntent } from "./plan-run-actions";
import type { usePlanEditor } from "./use-plan-editor";

/** Project and workspace of the plan; a remote target names its host. */
function planContextLine(
  page: AgentPlanPage,
  editor: ReturnType<typeof usePlanEditor>,
  translate: TFunction,
): string {
  const workspace = page.workspaces.find(
    (entry) => entry.id === editor.draft.workspaceId,
  );
  if (!workspace && page.selected)
    return `${page.selected.projectName} · ${translate("plans.manage.withoutWorkspace")}`;
  const target = editor.draft.executionTarget;
  if (target?.kind === "remote") {
    const remote = page.remoteWorkspaces?.find(
      (entry) => entry.workspaceId === target.workspaceId,
    );
    return translate("plans.manage.remoteContext", {
      project: workspace?.projectName ?? "",
      workspace:
        remote?.workspaceName ?? translate("plans.execution.unavailable"),
      host: remote?.connectionName ?? "",
    });
  }
  return [workspace?.projectName, workspace?.name].filter(Boolean).join(" · ");
}

interface PlanPanelHeadingProps {
  readonly page: AgentPlanPage;
  readonly editor: ReturnType<typeof usePlanEditor>;
  readonly control: AgentPlanControl | undefined;
  readonly isPending: boolean;
  readonly pendingIntent: PlanRunIntent | null;
  readonly hasDeletedFrontier: boolean;
  readonly isOpen: boolean;
  readonly detailsId: string;
  readonly onToggle: () => void;
  readonly onAction: (intent: PlanRunIntent) => void;
  /** Carries out the action that lifts the block of Fortsetzen. */
  readonly onResolveBlock: (action: AgentPlanResumeAction) => void;
  readonly onManage: (dialog: PlanManagementDialog) => void;
}

/**
 * Plan identity, explicit save, run controls and the plan menu stay visible while the graph moves.
 *
 * @remarks
 * Saving the graph and the run controls are separate: Starten never saves,
 * and Speichern never starts a run. Collapsed, the heading is one row
 * without its notes; only the button that lifts a block of Fortsetzen joins
 * the run controls (PAGE-338).
 */
export function PlanPanelHeading(
  props: PlanPanelHeadingProps,
): React.ReactElement {
  const { t } = useTranslation();
  const { editor, control } = props;
  return (
    <>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 pt-3.5">
        <div className="min-w-0 flex-1 basis-40 pt-0.5">
          <h2
            className="truncate text-sm font-semibold"
            title={editor.draft.name}
          >
            {editor.draft.name || t("plans.title")}
          </h2>
          <p className="text-xs wrap-anywhere text-muted-foreground">
            {planContextLine(props.page, editor, t)}
          </p>
          {props.page.selected?.oneShot ? (
            <PlanOneShotBadge className="mt-1" />
          ) : null}
          {props.page.selected ? (
            <PlanAccessBadges plan={props.page.selected} />
          ) : null}
        </div>
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
          <PlanSaveButton editor={editor} isPending={props.isPending} />
          {/* On narrow screens the run controls take their own row below. */}
          <div className="max-sm:order-last max-sm:basis-full">
            <PlanRunActions
              isReadOnly={
                props.page.selected ? !canRunPlan(props.page.selected) : false
              }
              control={control}
              isPending={props.isPending}
              pendingIntent={props.pendingIntent}
              isDirty={editor.isDirty}
              hasDeletedFrontier={props.hasDeletedFrontier}
              onAction={props.onAction}
            />
          </div>
          {props.isOpen ? null : (
            <PlanResumeBlockButton
              control={control}
              isPending={props.isPending}
              onResolve={props.onResolveBlock}
            />
          )}
          <div className="flex items-center gap-1">
            <PlanPanelMenu
              page={props.page}
              control={control}
              canEdit={editor.canEdit}
              onOpen={props.onManage}
            />
            <Button
              size="icon-sm"
              variant="ghost"
              className="size-9 min-h-9 xl:min-h-9 [@media(pointer:coarse)]:size-11"
              onClick={props.onToggle}
              aria-expanded={props.isOpen}
              aria-controls={props.detailsId}
              aria-label={t(
                props.isOpen ? "plans.panel.collapse" : "plans.panel.expand",
              )}
            >
              {props.isOpen ? (
                <ChevronUp aria-hidden="true" className="size-4" />
              ) : (
                <ChevronDown aria-hidden="true" className="size-4" />
              )}
            </Button>
          </div>
        </div>
      </div>
      {props.page.selected ? (
        <PlanOneShotNotice
          plan={props.page.selected}
          status={control?.status}
          isHidden={!props.isOpen}
        />
      ) : null}
      {props.isOpen ? (
        <>
          <PlanSaveStatus editor={editor} control={control} />
          <PlanControlNotes {...props} />
        </>
      ) : null}
    </>
  );
}

function PlanSaveButton({
  editor,
  isPending,
}: Pick<PlanPanelHeadingProps, "editor" | "isPending">): React.ReactElement {
  const { t } = useTranslation();
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-9 px-4 text-xs font-semibold [@media(pointer:coarse)]:min-h-11"
      onClick={editor.save}
      aria-busy={editor.isSaving}
      disabled={
        !editor.canEdit ||
        isPending ||
        !editor.isDirty ||
        !editor.draft.workspaceId
      }
    >
      {editor.isSaving ? (
        <Loader2 aria-hidden="true" className="mr-1.5 size-3.5 animate-spin" />
      ) : null}
      {t("plans.execution.save")}
    </Button>
  );
}

function PlanControlNotes(props: PlanPanelHeadingProps): React.ReactElement {
  const { t } = useTranslation();
  const { control } = props;
  return (
    <>
      <PlanResumeBlockNotice
        control={control}
        isPending={props.isPending}
        onResolve={props.onResolveBlock}
      />
      {control?.workspaceWait ? (
        <p
          role="status"
          className="px-4 pt-2 text-xs wrap-anywhere text-warning"
        >
          {t("plans.recovery.writerWait", {
            resource: control.workspaceWait.resource,
            run: control.workspaceWait.runId ?? t("plans.recovery.otherOwner"),
          })}{" "}
          {t(`plans.recovery.cleanupBlocker.${control.workspaceWait.reason}`, {
            defaultValue: control.workspaceWait.reason,
          })}
        </p>
      ) : null}
      {control?.cleanup?.map((entry) => (
        <p
          key={`${entry.workspaceId}:${entry.runId}`}
          role="status"
          className="px-4 pt-2 text-xs wrap-anywhere text-warning"
        >
          {t("plans.recovery.cleanupObligation", {
            workspace: entry.workspaceName,
            run: entry.runId,
          })}{" "}
          {t(`plans.recovery.cleanupBlocker.${entry.blocker}`, {
            defaultValue: entry.blocker,
          })}
        </p>
      ))}
      {props.page.selected?.isWorkspaceMissing ? (
        <p
          role="status"
          className="px-4 pt-2 text-xs wrap-anywhere text-warning"
        >
          {t("plans.manage.reassignWorkspace")}
        </p>
      ) : null}
    </>
  );
}

/** Says what is true of the draft now: stored, unsaved, or being stored. */
function saveStateLabel(
  editor: ReturnType<typeof usePlanEditor>,
  translate: TFunction,
): string {
  if (editor.isSaving) return translate("plans.panel.savingShort");
  return translate(
    editor.isDirty ? "plans.panel.unsavedShort" : "plans.panel.savedShort",
  );
}

/** Says whether the draft is stored, and that a run which executes steps locks the plan. */
function PlanSaveStatus({
  editor,
  control,
}: Pick<PlanPanelHeadingProps, "editor" | "control">): React.ReactElement {
  const { t } = useTranslation();
  return (
    <>
      <p className="px-4 pt-3 text-xs text-muted-foreground">
        {saveStateLabel(editor, t)}
      </p>
      {control && isPlanEditLocked(control.status) ? (
        <p
          role="status"
          className="px-4 pt-1 text-xs wrap-anywhere text-muted-foreground"
        >
          {t("plans.execution.editLocked")}
        </p>
      ) : null}
    </>
  );
}
