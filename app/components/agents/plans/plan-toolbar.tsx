import { Pause, Play, Plus, Save, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import { Button } from "@/app/components/ui/button";
import { Select } from "@/app/components/ui/select";

import { PlanDelete } from "./plan-delete";

import type { AgentPlanPage, AgentPlanRun } from "@/definition/AgentPlan";
import type { usePlanEditor } from "./use-plan-editor";

const ACTION_HINTS = {
  savingAndStarting: "plans.savingAndStarting",
  starting: "plans.starting",
  active: "plans.stopBeforePlay",
  unsaved: "plans.saveBeforePlay",
} as const;

/** Saved plan navigation uses the existing route so back/forward and dirty-draft protection work together. */
export function PlanHeader({
  page,
}: {
  readonly page: AgentPlanPage;
}): React.ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  function selectPlan(id: string): void {
    void navigate(
      id ? `/agents/plans?planId=${encodeURIComponent(id)}` : "/agents/plans",
    );
  }
  return (
    <header className="flex min-w-0 flex-wrap items-center gap-2">
      <h1 className="pr-1 text-lg font-semibold">{t("plans.title")}</h1>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Select
          ariaLabel={t("plans.choosePlan")}
          value={page.selected?.id ?? ""}
          onValueChange={selectPlan}
          options={[
            { value: "", label: t("plans.newPlan") },
            ...page.plans.map((plan) => ({ value: plan.id, label: plan.name })),
          ]}
        />
        <Button size="sm" variant="outline" onClick={() => selectPlan("")}>
          <Plus className="size-4" aria-hidden="true" />
          {t("plans.newPlan")}
        </Button>
        {page.selected ? <PlanDelete plan={page.selected} /> : null}
      </div>
    </header>
  );
}

/** Play starts the plan as the editor shows it; unsaved changes are saved first and become the revision the run executes. */
export function PlanActions(props: {
  readonly editor: ReturnType<typeof usePlanEditor>;
  readonly hasSelection: boolean;
  readonly run: AgentPlanRun | null;
}): React.ReactElement {
  const { t } = useTranslation();
  const { editor, run } = props;
  return (
    <div className="flex flex-wrap items-center gap-2 xl:ml-auto">
      <Button
        size="sm"
        disabled={
          !editor.canEdit ||
          editor.isPending ||
          !editor.draft.name.trim() ||
          !editor.draft.workspaceId
        }
        onClick={editor.save}
      >
        <Save className="size-4" aria-hidden="true" />
        {t("plans.save")}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={!canPlay(props)}
        onClick={editor.play}
      >
        <Play className="size-4" aria-hidden="true" />
        {t("plans.play")}
      </Button>
      <RunControl editor={editor} run={run} />
      <ActionHint editor={editor} isActive={isActiveRun(run)} />
    </div>
  );
}

function isActiveRun(run: AgentPlanRun | null): boolean {
  return run?.status === "running" || run?.status === "paused";
}

/** A run that is active or paused is stopped first; a new start never runs beside it. */
function canPlay(props: {
  readonly editor: ReturnType<typeof usePlanEditor>;
  readonly hasSelection: boolean;
  readonly run: AgentPlanRun | null;
}): boolean {
  const { editor } = props;
  if (editor.isPending || !props.hasSelection || isActiveRun(props.run))
    return false;
  if (
    editor.graph.issues.length > 0 ||
    !editor.draft.nodes.some((node) => node.type === "agent")
  )
    return false;
  // Play saves unsaved changes, so they need everything Save needs.
  return (
    !editor.isDirty ||
    (editor.canEdit &&
      editor.draft.name.trim() !== "" &&
      editor.draft.workspaceId !== "")
  );
}

function actionHint(
  editor: ReturnType<typeof usePlanEditor>,
  isActive: boolean,
): keyof typeof ACTION_HINTS | null {
  const submission = editor.command.formData;
  if (editor.isPending && submission?.get("intent") === "play-plan")
    return submission.has("plan") ? "savingAndStarting" : "starting";
  if (isActive) return "active";
  return editor.isDirty ? "unsaved" : null;
}

function ActionHint({
  editor,
  isActive,
}: {
  readonly editor: ReturnType<typeof usePlanEditor>;
  readonly isActive: boolean;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const hint = actionHint(editor, isActive);
  if (hint === null) return null;
  return (
    <p role="status" className="text-xs text-muted-foreground">
      {t(ACTION_HINTS[hint])}
    </p>
  );
}

function RunControl({
  editor,
  run,
}: {
  readonly editor: ReturnType<typeof usePlanEditor>;
  readonly run: AgentPlanRun | null;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (!run || !isActiveRun(run)) return null;
  const isPaused = run.status === "paused";
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={editor.isPending || run.stopRequested}
        onClick={() =>
          isPaused ? editor.resume(run.id) : editor.pause(run.id)
        }
      >
        {isPaused ? (
          <Play className="size-4" aria-hidden="true" />
        ) : (
          <Pause className="size-4" aria-hidden="true" />
        )}
        {t(isPaused ? "plans.resume" : "plans.pause")}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={editor.isPending || run.stopRequested}
        onClick={() => editor.stop(run.id)}
      >
        <Square className="size-4" aria-hidden="true" />
        {t(run.stopRequested ? "plans.stopRequested" : "plans.stop")}
      </Button>
    </>
  );
}
