import { useTranslation } from "react-i18next";

import { PlanCanvas } from "./plan-canvas";
import { PlanConnections } from "./plan-connections";
import { PlanFields } from "./plan-fields";
import { PlanPanel } from "./plan-panel";
import { PlanLeaveGuard } from "./plan-leave-guard";
import { PlanRunView } from "./plan-run-view";
import { PlanValidation } from "./plan-validation";
import { PlanActions, PlanHeader } from "./plan-toolbar";
import { usePlanEditor } from "./use-plan-editor";
import { usePlanRun } from "./use-plan-run";

import type { AgentPlanPage } from "@/definition/AgentPlan";

/** Keeps metadata compact and the grid dominant, with a collapsible source and selection panel over it. */
export function PlanPage({
  page,
}: {
  readonly page: AgentPlanPage;
}): React.ReactElement {
  const { t } = useTranslation();
  const editor = usePlanEditor(page);
  const running = usePlanRun(page.runs, editor.command.data);
  const disabled = !editor.canEdit || editor.isPending;
  const response = editor.command.data;
  const failure = response?.ok === false ? response.error : editor.sourceError;
  const issues = [
    ...editor.graph.issues,
    ...(response?.ok === false ? (response.issues ?? []) : []),
    ...(editor.graph.connectionIssue ? [editor.graph.connectionIssue] : []),
  ];
  return (
    <div className="w-full space-y-3 px-2 pt-3 pb-10">
      <PlanHeader page={page} />
      <details
        open={!page.selected}
        className="rounded-xl border border-border p-3"
      >
        <summary className="cursor-pointer text-sm font-medium">
          {t("plans.metadata")}
          {page.selected ? ` · ${page.selected.name}` : ""}
        </summary>
        <div className="pt-3">
          <PlanFields
            draft={editor.draft}
            workspaces={page.workspaces}
            directory={page.directory}
            disabled={disabled}
            onChange={editor.setDraft}
          />
        </div>
      </details>
      {failure ? (
        <p role="alert" className="text-sm text-destructive">
          {t(`settings.agents.error.${failure}`, {
            defaultValue: t(`assistant.error.${failure}`),
          })}
        </p>
      ) : null}
      <PlanActions
        editor={editor}
        hasSelection={page.selected !== null}
        run={running.run}
      />
      <p className="text-sm text-muted-foreground">{t("plans.canvasHint")}</p>
      <div className="relative">
        <div className="relative h-[max(28rem,calc(100dvh-21rem))] overflow-hidden rounded-xl border border-border">
          <PlanCanvas
            draft={editor.draft}
            sources={editor.sources}
            graph={editor.graph}
            canEdit={!disabled && Boolean(editor.draft.workspaceId)}
            run={running.run}
          />
        </div>
        <PlanPanel page={page} editor={editor} />
      </div>
      <PlanValidation
        issues={issues}
        draft={editor.draft}
        sources={editor.sources}
        onSelect={editor.graph.select}
      />
      <details>
        <summary className="cursor-pointer text-sm">
          {t("plans.dependencies")}
        </summary>
        <PlanConnections
          draft={editor.draft}
          sources={editor.sources}
          graph={editor.graph}
          disabled={disabled}
        />
      </details>
      <PlanRunView
        state={running}
        isPending={editor.isPending}
        onStop={editor.stop}
      />
      <PlanLeaveGuard isDirty={editor.isDirty} />
    </div>
  );
}
