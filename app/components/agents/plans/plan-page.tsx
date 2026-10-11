import { useTranslation } from "react-i18next";

import { PlanCanvas } from "./plan-canvas";
import { PlanConnections } from "./plan-connections";
import { PlanFields } from "./plan-fields";
import { PlanGlobals } from "./plan-globals";
import { PlanInspector } from "./plan-inspector";
import { PlanLeaveGuard } from "./plan-leave-guard";
import { PlanRunView } from "./plan-run-view";
import { PlanSources } from "./plan-sources";
import { PlanActions, PlanHeader } from "./plan-toolbar";
import { usePlanEditor } from "./use-plan-editor";
import { usePlanRun } from "./use-plan-run";

import type { AgentPlanPage } from "@/definition/AgentPlan";

/** Composes plan selection, metadata, source sets, graph editing and immutable run progress. */
export function PlanPage({
  page,
}: {
  readonly page: AgentPlanPage;
}): React.ReactElement {
  const { t } = useTranslation();
  const editor = usePlanEditor(page);
  const running = usePlanRun(page.runs, editor.command.data);
  const disabled = !editor.canEdit || editor.isPending;
  const failure =
    editor.command.data?.ok === false
      ? editor.command.data.error
      : editor.sourceError;
  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-2 pt-3 pb-10">
      <PlanHeader page={page} />
      <PlanFields
        draft={editor.draft}
        workspaces={page.workspaces}
        disabled={disabled}
        onChange={editor.setDraft}
      />
      <PlanGlobals
        draft={editor.draft}
        disabled={disabled}
        onChange={editor.setDraft}
        graph={editor.graph}
      />
      {failure ? (
        <p role="alert" className="text-sm text-destructive">
          {t(`settings.agents.error.${failure}`, {
            defaultValue: t(`assistant.error.${failure}`),
          })}
        </p>
      ) : null}
      <PlanActions editor={editor} hasSelection={page.selected !== null} />
      <PlanSources
        sources={editor.sources}
        graph={editor.graph}
        canEdit={!disabled && Boolean(editor.draft.workspaceId)}
      />
      <PlanCanvas
        draft={editor.draft}
        sources={editor.sources}
        graph={editor.graph}
        canEdit={!disabled && Boolean(editor.draft.workspaceId)}
      />
      <PlanInspector
        draft={editor.draft}
        sources={editor.sources}
        workspaces={page.workspaces}
        graph={editor.graph}
        disabled={disabled}
      />
      <PlanConnections
        draft={editor.draft}
        sources={editor.sources}
        disabled={disabled}
        onChange={editor.setDraft}
      />
      <PlanRunView
        state={running}
        isPending={editor.isPending}
        onStop={editor.stop}
      />
      <PlanLeaveGuard isDirty={editor.isDirty} />
    </div>
  );
}
