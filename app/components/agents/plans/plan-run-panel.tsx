import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { expandPlanGroups } from "@/definition/AgentPlanGroup";

import { PlanPanelContext } from "./plan-panel-context";
import { PlanRunActions } from "./plan-run-actions";

import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";
import type { AgentPlanPage } from "@/definition/AgentPlan";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";
import type { PlanRunIntent } from "./plan-run-actions";
import type { usePlanEditor } from "./use-plan-editor";

/** Fixed within the editor, independent of graph position, viewport and zoom. */
export function PlanRunPanel(props: {
  readonly page: AgentPlanPage;
  readonly editor: ReturnType<typeof usePlanEditor>;
  readonly control: AgentPlanControl | undefined;
  readonly error: string | null;
}): React.ReactElement {
  const { t } = useTranslation();
  const [isOpen, setOpen] = useState(false);
  const { editor, control } = props;
  const workspace = props.page.workspaces.find(
    (entry) => entry.id === editor.draft.workspaceId,
  );
  const { hasDeletedFrontier, state } = panelPresentation(props);
  const toggle = isOpen ? t("plans.panel.collapse") : t("plans.panel.expand");
  function action(intent: PlanRunIntent): void {
    void editor.command.submit(
      {
        intent,
        planId: props.page.selected?.id ?? "",
        runId: control?.runId ?? "",
        revision: String(editor.draft.revision ?? ""),
      },
      { method: "post", action: "/agents/plans", flushSync: true },
    );
  }
  return (
    <section
      aria-label={t("plans.panel.label")}
      data-plan-panel
      className="pointer-events-auto min-h-0 w-full overflow-y-auto rounded-2xl border border-border/70 bg-surface/95 text-foreground shadow-panel backdrop-blur-sm"
    >
      <div className="sticky top-0 z-10 flex min-w-0 flex-wrap items-center gap-3 bg-surface p-3">
        <div className="min-w-0 flex-1 basis-36">
          <p
            title={workspace?.projectName}
            className="truncate text-sm font-semibold"
          >
            {workspace?.projectName ?? t("workspaces.chooseProject")}
          </p>
          <p
            title={workspace?.name}
            className="truncate text-xs text-muted-foreground"
          >
            {workspace?.name ?? t("plans.panel.workspace")}
          </p>
        </div>
        <output
          aria-live="polite"
          className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium"
        >
          {t(`plans.panel.status.${state}`)}
        </output>
        <Button
          size="icon"
          variant="ghost"
          aria-label={toggle}
          title={toggle}
          aria-expanded={isOpen}
          aria-controls="plan-panel-context"
          onClick={() => setOpen(!isOpen)}
        >
          {isOpen ? (
            <ChevronUp className="size-4" />
          ) : (
            <ChevronDown className="size-4" />
          )}
        </Button>
        <PlanRunActions
          isReadOnly={props.page.selected?.canEdit === false}
          control={control}
          isPending={editor.isPending || Boolean(props.error)}
          isDirty={editor.isDirty}
          hasDeletedFrontier={hasDeletedFrontier}
          onAction={action}
        />
      </div>
      <PlanPanelBody {...props} />
      {isOpen ? <PlanPanelContext page={props.page} editor={editor} /> : null}
    </section>
  );
}

function PlanPanelBody(
  props: Parameters<typeof PlanRunPanel>[0],
): React.ReactElement {
  const { t } = useTranslation();
  const { editor, control } = props;
  const { error, issue } = panelPresentation(props);
  return (
    <>
      {props.page.selected?.canEdit === false ? (
        <p className="px-4 pb-2 text-xs text-muted-foreground">
          {t("plans.flow.storage.readOnly")}
        </p>
      ) : null}
      <PlanPanelFeedback
        control={control}
        issue={issue ?? null}
        error={error}
        isDirty={editor.isDirty}
        issues={
          editor.command.data?.ok === false
            ? editor.command.data.issues
            : control?.issues
        }
      />
    </>
  );
}

function PlanPanelFeedback(props: {
  readonly control: AgentPlanControl | undefined;
  readonly issue: string | null;
  readonly error: string | null;
  readonly isDirty: boolean;
  readonly issues?: readonly AgentPlanIssue[];
}): React.ReactElement {
  const { t } = useTranslation();
  const { control } = props;
  const isActive = ["running", "pausing", "paused"].includes(
    control?.status ?? "",
  );
  return (
    <div className="space-y-2 px-4 pb-3 text-xs text-muted-foreground">
      <p>{t(isActive ? "plans.panel.stopFirst" : "plans.panel.newRunHint")}</p>
      {props.isDirty ? <p role="status">{t("plans.panel.unsaved")}</p> : null}
      {control?.status === "paused" ? (
        <p>{t("plans.panel.pausedHint")}</p>
      ) : null}
      {control?.status === "stopping" ? (
        <p role="status">{t("plans.panel.stoppingHint")}</p>
      ) : null}
      {control?.continuationVersion ? (
        <p>
          {t("plans.panel.revision", {
            version: control.continuationVersion,
            revision: control.planRevision,
          })}
        </p>
      ) : null}
      {props.issue ? (
        <details className="rounded-lg border border-border p-2">
          <summary className="cursor-pointer font-medium text-foreground">
            {t("plans.panel.reason")}
          </summary>
          <p className="pt-2">
            {t(`settings.agents.error.${props.issue}`, {
              defaultValue: props.issue,
            })}
          </p>
          {control ? (
            <p className="pt-2">
              {t("plans.panel.actualState", {
                state: t(`plans.panel.status.${control.status}`),
              })}
            </p>
          ) : null}
        </details>
      ) : null}
      <PlanPanelIssues issues={props.issues} />
      {props.error ? (
        <p role="alert" className="text-destructive">
          {t(`settings.agents.error.${props.error}`, {
            defaultValue: t("plans.panel.error"),
          })}
        </p>
      ) : null}
    </div>
  );
}

function panelPresentation(props: Parameters<typeof PlanRunPanel>[0]): {
  readonly hasDeletedFrontier: boolean;
  readonly error: string | null;
  readonly issue: string | null;
  readonly state: string;
} {
  const { editor, control } = props;
  const nodes = expandPlanGroups(editor.draft).nodes;
  const hasDeletedFrontier =
    control?.status === "paused" &&
    control.frontierStepIds.some((id) => !nodes.some((node) => node.id === id));
  const result = editor.command.data;
  const error =
    props.error ??
    editor.sourceError ??
    (result?.ok === false ? result.error : null);
  const issue = hasDeletedFrontier
    ? "plan_continuation_deleted"
    : (control?.issue ?? null);
  return {
    hasDeletedFrontier,
    error,
    issue,
    state: panelStatus(control, issue),
  };
}

function panelStatus(
  control: AgentPlanControl | undefined,
  issue: string | null,
): string {
  if (control?.status === "stopping") return "stopping";
  return issue ? "blocked" : (control?.status ?? "idle");
}

function PlanPanelIssues({
  issues = [],
}: {
  readonly issues: readonly AgentPlanIssue[] | undefined;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (issues.length === 0) return null;
  return (
    <ul
      role="alert"
      className="list-inside list-disc space-y-1 text-destructive"
    >
      {issues.slice(0, 5).map((issue, index) => (
        <li key={index}>
          {issue.nodeId}: {t(`plans.validation.${issue.reason}`)}
        </li>
      ))}
    </ul>
  );
}
