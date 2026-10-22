import { useState } from "react";
import { useTranslation } from "react-i18next";

import { isAgentParameterName } from "@/definition/AgentParameters";
import { expandPlanGroups } from "@/definition/AgentPlanGroup";
import { ScrollViewport } from "@/app/components/ui/scroll-viewport";

import { planAgentName } from "./plan-layout";
import { keepPlanControlKeys } from "./plan-flow-keys";
import { isPlanNameRefused } from "./plan-name-issue";
import { PlanPanelContext } from "./plan-panel-context";
import { PlanRecoveryPanel } from "./plan-recovery-panel";
import { PlanReloadButton } from "./plan-reload-button";
import { PlanPanelHeading } from "./plan-panel-heading";

import type { TFunction } from "i18next";
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
  /** Shows a run that a restart or resume started. */
  readonly onRunStarted: (runId: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const [isOpen, setOpen] = useState(false);
  const { editor, control } = props;
  // A refused name is fixed in the context section, so a closed panel opens on it once.
  const [shownRefusal, setShownRefusal] = useState(false);
  const isRefused = isPlanNameRefused(
    editor.command.data,
    editor.submittedName,
    editor.draft.name,
  );
  if (isRefused !== shownRefusal) {
    setShownRefusal(isRefused);
    if (isRefused) setOpen(true);
  }
  const { hasDeletedFrontier } = panelPresentation(props);
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
    <ScrollViewport
      as="section"
      axis="vertical"
      aria-label={t("plans.panel.label")}
      data-plan-panel
      onKeyDown={keepPlanControlKeys}
      containerClassName="min-h-0 w-full"
      className="pointer-events-auto overflow-y-auto rounded-xl border border-border/70 bg-surface/95 text-foreground shadow-panel backdrop-blur-sm"
    >
      <PlanPanelHeading
        page={props.page}
        editor={editor}
        control={control}
        isPending={editor.isPending || Boolean(props.error)}
        hasDeletedFrontier={hasDeletedFrontier}
        isOpen={isOpen}
        onToggle={() => setOpen(!isOpen)}
        onAction={action}
      />
      <PlanPanelBody {...props} />
      {isOpen ? <PlanPanelContext page={props.page} editor={editor} /> : null}
    </ScrollViewport>
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
        <p className="px-2.5 pb-1.5 text-xs wrap-anywhere text-muted-foreground">
          {t("plans.flow.storage.readOnly")}
        </p>
      ) : null}
      <PlanPanelFeedback
        control={control}
        issue={issue ?? null}
        error={error}
        isDirty={editor.isDirty}
        editor={editor}
        issues={
          editor.command.data?.ok === false
            ? editor.command.data.issues
            : control?.issues
        }
      />
      {props.page.selected?.canEdit === false ? null : (
        <PlanRecoveryPanel
          control={control}
          onRunStarted={props.onRunStarted}
        />
      )}
    </>
  );
}

function PlanPanelFeedback(props: {
  readonly control: AgentPlanControl | undefined;
  readonly issue: string | null;
  readonly error: string | null;
  readonly isDirty: boolean;
  readonly editor: ReturnType<typeof usePlanEditor>;
  readonly issues?: readonly AgentPlanIssue[];
}): React.ReactElement {
  const { t } = useTranslation();
  const { control } = props;
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5 px-2.5 text-xs leading-4 wrap-anywhere text-muted-foreground @2xl:text-[10px]">
      {props.isDirty ? (
        <p role="status" className="basis-full">
          {t("plans.panel.unsaved")}
        </p>
      ) : null}
      {control?.status === "paused" ? (
        <p className="basis-full">{t("plans.panel.pausedHint")}</p>
      ) : null}
      {control?.status === "stopping" ? (
        <p role="status" className="basis-full">
          {t("plans.panel.stoppingHint")}
        </p>
      ) : null}
      {control?.continuationVersion ? (
        <p className="basis-full">
          {t("plans.panel.revision", {
            version: control.continuationVersion,
            revision: control.planRevision,
          })}
        </p>
      ) : null}
      {props.issue ? (
        <details className="open:basis-full open:border-t open:border-border open:pt-1.5">
          <summary className="cursor-pointer rounded-sm font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:py-3">
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
      <PlanPanelIssues issues={props.issues} editor={props.editor} />
      {props.error ? (
        <p
          role="alert"
          className="flex basis-full flex-wrap items-center gap-2 text-destructive"
        >
          {t(`settings.agents.error.${props.error}`, {
            defaultValue: t("plans.panel.error"),
          })}
          {props.error === "plan_conflict" ? <PlanReloadButton /> : null}
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

/** Names the node and input of a finding by their names, never by an identifier. */
function issueSubject(
  issue: AgentPlanIssue,
  editor: ReturnType<typeof usePlanEditor>,
  translate: TFunction,
): string {
  // Frames are replaced by their members when groups are expanded.
  const node = [
    ...editor.draft.nodes,
    ...expandPlanGroups(editor.draft).nodes,
  ].find((entry) => entry.id === issue.nodeId);
  let name = "";
  if (node?.type === "agent")
    name =
      planAgentName(node, editor.sources) || translate("plans.missingAgent");
  else if (node?.type === "task") {
    const task = editor.sources.tasks.find((entry) => entry.id === node.taskId);
    name = task ? task.key : translate("plans.ticketUnavailable");
  } else if (node?.type === "start" || node?.type === "end")
    name = translate(`plans.nodeType.${node.type}`);
  else if (node) name = node.name;
  const port = issue.port && isAgentParameterName(issue.port) ? issue.port : "";
  return [name, port].filter(Boolean).join(" · ");
}

function PlanPanelIssues({
  issues = [],
  editor,
}: {
  readonly issues: readonly AgentPlanIssue[] | undefined;
  readonly editor: ReturnType<typeof usePlanEditor>;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (issues.length === 0) return null;
  return (
    <ul
      role="alert"
      className="basis-full list-inside list-disc space-y-1 text-destructive"
    >
      {issues.slice(0, 5).map((issue, index) => (
        <li key={index}>
          {[
            issueSubject(issue, editor, t),
            t(`plans.validation.${issue.reason}`),
          ]
            .filter(Boolean)
            .join(": ")}
        </li>
      ))}
    </ul>
  );
}
