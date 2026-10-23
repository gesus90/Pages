import { ChevronDown, ChevronUp } from "lucide-react";
import { useTranslation } from "react-i18next";

import { isActivePlanRun } from "@/definition/AgentPlanRunState";

import { Button } from "@/app/components/ui/button";

import { PlanPanelMenu } from "./plan-panel-menu";
import { PlanRunActions } from "./plan-run-actions";

import type { TFunction } from "i18next";
import type { AgentPlanPage } from "@/definition/AgentPlan";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";
import type { PlanManagementDialog } from "./plan-management/use-plan-management";
import type {
  PlanRecoveryResumeState,
  PlanRunIntent,
} from "./plan-run-actions";
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
  const target = editor.draft.executionTarget;
  const remote =
    target?.kind === "remote"
      ? page.remoteWorkspaces?.find(
          (entry) => entry.workspaceId === target.workspaceId,
        )
      : undefined;
  if (target?.kind === "remote")
    return translate("plans.manage.remoteContext", {
      project: workspace?.projectName ?? "",
      workspace:
        remote?.workspaceName ?? translate("plans.execution.unavailable"),
      host: remote?.connectionName ?? "",
    });
  return [workspace?.projectName, workspace?.name].filter(Boolean).join(" · ");
}

/** Whether a run is active; its snapshot then stays pinned whatever is saved. */
function isActiveControl(control: AgentPlanControl | undefined): boolean {
  return Boolean(
    control && control.status !== "idle" && isActivePlanRun(control.status),
  );
}

interface PlanPanelHeadingProps {
  readonly page: AgentPlanPage;
  readonly editor: ReturnType<typeof usePlanEditor>;
  readonly control: AgentPlanControl | undefined;
  readonly isPending: boolean;
  readonly pendingIntent: PlanRunIntent | null;
  readonly hasDeletedFrontier: boolean;
  readonly recovery: PlanRecoveryResumeState | null;
  readonly isOpen: boolean;
  readonly detailsId: string;
  readonly onToggle: () => void;
  readonly onAction: (intent: PlanRunIntent) => void;
  readonly onRecover: () => void;
  readonly onManage: (dialog: PlanManagementDialog) => void;
}

/**
 * Plan identity, explicit save, run controls and the plan menu stay visible while the graph moves.
 *
 * @remarks
 * Saving the graph and the run controls are separate: Starten never saves,
 * and Speichern never starts a run.
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
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-9 px-4 text-xs font-semibold [@media(pointer:coarse)]:min-h-11"
            onClick={editor.save}
            disabled={
              !editor.canEdit ||
              props.isPending ||
              !editor.isDirty ||
              !editor.draft.workspaceId
            }
          >
            {t("plans.execution.save")}
          </Button>
          {/* On narrow screens the run controls take their own row below. */}
          <div className="max-sm:order-last max-sm:basis-full">
            <PlanRunActions
              isReadOnly={props.page.selected?.canEdit === false}
              control={control}
              isPending={props.isPending}
              pendingIntent={props.pendingIntent}
              isDirty={editor.isDirty}
              hasDeletedFrontier={props.hasDeletedFrontier}
              recovery={props.recovery}
              onAction={props.onAction}
              onRecover={props.onRecover}
            />
          </div>
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
      <PlanRevisionStatus editor={editor} control={control} />
    </>
  );
}

/** Distinguishes the editable revision from a currently active execution basis. */
function PlanRevisionStatus({
  editor,
  control,
}: Pick<PlanPanelHeadingProps, "editor" | "control">): React.ReactElement {
  const { t } = useTranslation();
  return (
    <p className="px-4 pt-3 text-xs text-muted-foreground">
      {t("plans.execution.editRevision", {
        revision: editor.draft.revision ?? 0,
      })}
      {editor.isDirty
        ? ` · ${t("plans.panel.unsavedShort")}`
        : ` · ${t("plans.panel.savedShort")}`}
      {isActiveControl(control) && control?.runId
        ? ` · ${t("plans.execution.activeSnapshot", { revision: control.planRevision })}`
        : null}
    </p>
  );
}

/** Says that a saved revision waits for the next run while the active run keeps its snapshot. */
export function PlanNextRunNote({
  editor,
  control,
}: Pick<
  PlanPanelHeadingProps,
  "editor" | "control"
>): React.ReactElement | null {
  const { t } = useTranslation();
  if (
    !isActiveControl(control) ||
    !control?.runId ||
    control.planRevision === editor.draft.revision
  )
    return null;
  return (
    <div className="text-xs">
      <p className="font-semibold">{t("plans.execution.nextRunTitle")}</p>
      <p className="mt-1 text-muted-foreground">
        {t("plans.execution.nextRunHint", {
          revision: control.planRevision,
        })}
      </p>
    </div>
  );
}
