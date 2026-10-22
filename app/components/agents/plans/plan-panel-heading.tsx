import { ChevronDown, ChevronUp } from "lucide-react";
import { useTranslation } from "react-i18next";

import { isActivePlanRun } from "@/definition/AgentPlanRunState";

import { Button } from "@/app/components/ui/button";

import { PlanRunActions } from "./plan-run-actions";

import type { AgentPlanPage } from "@/definition/AgentPlan";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";
import type { PlanRunIntent } from "./plan-run-actions";
import type { usePlanEditor } from "./use-plan-editor";

/** Plan identity, explicit save and run controls stay visible while the graph moves. */
export function PlanPanelHeading(props: {
  readonly page: AgentPlanPage;
  readonly editor: ReturnType<typeof usePlanEditor>;
  readonly control: AgentPlanControl | undefined;
  readonly isPending: boolean;
  readonly hasDeletedFrontier: boolean;
  readonly isOpen: boolean;
  readonly onToggle: () => void;
  readonly onAction: (intent: PlanRunIntent) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { editor, control } = props;
  const workspace = props.page.workspaces.find(
    (entry) => entry.id === editor.draft.workspaceId,
  );
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 bg-surface px-3 py-2">
        <button
          type="button"
          className="min-w-0 flex-1 rounded text-left focus-visible:outline-2 focus-visible:outline-ring"
          aria-expanded={props.isOpen}
          aria-controls="plan-panel-context"
          onClick={props.onToggle}
        >
          <span className="block truncate text-sm font-semibold">
            {editor.draft.name || t("plans.title")}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {[workspace?.projectName, workspace?.name]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </button>
        <Button
          size="sm"
          variant="outline"
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
        <PlanRunActions
          isReadOnly={props.page.selected?.canEdit === false}
          control={control}
          isPending={props.isPending}
          isDirty={editor.isDirty}
          hasDeletedFrontier={props.hasDeletedFrontier}
          onAction={props.onAction}
        />
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={props.onToggle}
          aria-expanded={props.isOpen}
          aria-controls="plan-panel-context"
          aria-label={t(
            props.isOpen ? "plans.panel.collapse" : "plans.panel.expand",
          )}
        >
          {props.isOpen ? (
            <ChevronUp className="size-4" />
          ) : (
            <ChevronDown className="size-4" />
          )}
        </Button>
      </div>
      <PlanRevisionStatus editor={editor} control={control} />
    </>
  );
}

/** Distinguishes the editable revision from a currently active execution basis. */
function PlanRevisionStatus({
  editor,
  control,
}: Pick<
  Parameters<typeof PlanPanelHeading>[0],
  "editor" | "control"
>): React.ReactElement {
  const { t } = useTranslation();
  const isActive =
    control &&
    isActivePlanRun(control.status === "idle" ? "succeeded" : control.status);
  return (
    <>
      <p
        className="border-t border-border px-3 py-2 text-xs text-muted-foreground"
        role="status"
      >
        {t("plans.execution.editRevision", {
          revision: editor.draft.revision ?? 0,
        })}
        {editor.isDirty
          ? ` · ${t("plans.panel.unsaved")}`
          : ` · ${t("plans.saved")}`}
        {isActive && control?.runId
          ? ` · ${t("plans.execution.activeSnapshot", { revision: control.planRevision })}`
          : null}
      </p>
      {isActive &&
      control?.runId &&
      control.planRevision !== editor.draft.revision ? (
        <div className="border-t border-border px-3 py-3 text-xs">
          <p className="font-semibold">{t("plans.execution.nextRunTitle")}</p>
          <p className="mt-1 text-muted-foreground">
            {t("plans.execution.nextRunHint", {
              revision: control.planRevision,
            })}
          </p>
        </div>
      ) : null}
    </>
  );
}
