import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { PlanFields } from "./plan-fields";
import { PlanValidation } from "./plan-validation";
import { PlanActions, PlanHeader } from "./plan-toolbar";

import type { AgentPlanPage, AgentPlanRun } from "@/definition/AgentPlan";
import type { usePlanEditor } from "./use-plan-editor";

/**
 * The floating bar above the grid: plan choice, metadata, Save, Play, Pause and Stop.
 *
 * @remarks
 * It only arranges the existing controls; saving and starting keep their
 * semantics. Errors and the validation list stay next to the actions they
 * block.
 */
export function PlanConfigurationPanel(props: {
  readonly page: AgentPlanPage;
  readonly editor: ReturnType<typeof usePlanEditor>;
  readonly run: AgentPlanRun | null;
  readonly className?: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const { page, editor } = props;
  const disabled = !editor.canEdit || editor.isPending;
  const response = editor.command.data;
  const failure = response?.ok === false ? response.error : editor.sourceError;
  const issues = [
    ...editor.graph.issues,
    ...(response?.ok === false ? (response.issues ?? []) : []),
    ...(editor.graph.connectionIssue ? [editor.graph.connectionIssue] : []),
  ];
  return (
    <section
      aria-label={t("plans.configuration")}
      className={cn(
        "max-h-[calc(100%-4rem)] space-y-2 overflow-y-auto rounded-xl border border-border bg-surface/95 p-2 shadow-panel backdrop-blur",
        props.className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <PlanHeader page={page} />
        <PlanActions
          editor={editor}
          hasSelection={page.selected !== null}
          run={props.run}
        />
      </div>
      <details open={!page.selected} className="px-1">
        <summary className="cursor-pointer text-sm font-medium">
          {t("plans.metadata")}
          {page.selected ? ` · ${page.selected.name}` : ""}
        </summary>
        <div className="pt-2 pb-1">
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
        <p role="alert" className="px-1 text-sm text-destructive">
          {t(`settings.agents.error.${failure}`, {
            defaultValue: t(`assistant.error.${failure}`),
          })}
        </p>
      ) : null}
      <PlanValidation
        issues={issues}
        draft={editor.draft}
        sources={editor.sources}
        onSelect={editor.graph.select}
      />
    </section>
  );
}
