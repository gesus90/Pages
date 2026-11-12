import { Crosshair } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ScrollViewport } from "@/app/components/ui/scroll-viewport";
import { Button } from "@/app/components/ui/button";

import { PlanExecutionDetails } from "./plan-execution-details";
import { PlanStatusActivity } from "./plan-status-activity";
import { PlanStatusAgentTodos } from "./plan-status-agent-todos";
import { hasOpenPlanReport, PlanStatusBadge } from "./plan-status";
import { PlanStatusConfiguration } from "./plan-status-configuration";
import { isPlanDecisionResult, PlanStatusHistory } from "./plan-status-history";
import { PlanStatusTodos } from "./plan-status-todos";
import { PlanScriptRun } from "./plan-script-run";
import { PlanRemoteScriptRun } from "./plan-remote-script-run";
import { PlanStatusRetry, PlanStatusStop } from "./plan-status-retry";
import { PlanRemoteHistory } from "./plan-remote-history";
import { PlanStatusReport } from "./plan-status-report";
import { PlanScriptReport } from "./plan-script/plan-script-report";

import type { TFunction } from "i18next";
import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { PlanSequenceBlockKind } from "./plan-step-sequence";

interface StatusDetailsProps {
  readonly step: AgentPlanStepResult | undefined;
  readonly blockedByName?: string | null;
  readonly number: number;
  /** The loop iteration or start of a repeated execution; absent for a node that runs once. */
  readonly pass?: number | null;
  /** Whether the step is only planned or assumed, absent or `actual` once it started. */
  readonly kind?: PlanSequenceBlockKind;
  readonly end: string | null;
  readonly canLocate: boolean;
  readonly onLocate: () => void;
}

function isScript(step: AgentPlanStepResult): boolean {
  return (
    step.script !== undefined ||
    (step.execution?.target.kind === "remote" &&
      step.execution.modelAccess.provider === "script")
  );
}

/** An agent node, as opposed to a script or a decision. */
function isAgentStep(step: AgentPlanStepResult): boolean {
  return !isScript(step) && !isPlanDecisionResult(step);
}

/**
 * Whether the step has ticket or contract todos to list; the list of the
 * agent beside the details names its own empty state (PAGE-306).
 */
function hasTicketTodos(step: AgentPlanStepResult): boolean {
  return (
    isAgentStep(step) &&
    ((step.progress?.todos.length ?? 0) > 0 ||
      (step.session?.contract?.tickets.length ?? 0) > 0)
  );
}

/** The line under the heading: what kind of node the step is. */
function nodeKind(step: AgentPlanStepResult, translate: TFunction): string {
  if (isPlanDecisionResult(step)) return translate("plans.nodeType.decision");
  return isScript(step)
    ? translate("plans.nodeType.script")
    : translate("plans.progress.agent", { name: step.name });
}

/** Consistent run-step details, with honest empty states when the runner reports no live activity. */
export function PlanStatusDetails({
  step,
  blockedByName,
  number,
  pass,
  kind,
  end,
  canLocate,
  onLocate,
}: StatusDetailsProps): React.ReactElement {
  const { t } = useTranslation();
  if (!step)
    return (
      <p className="px-4 py-3 text-xs leading-4.5 text-muted-foreground">
        {t("plans.progress.noSelection")}
      </p>
    );
  const hasAgentList = isAgentStep(step);
  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-border @2xl/status:flex-row">
      <ScrollViewport
        axis="vertical"
        tabIndex={0}
        role="region"
        aria-label={t("plans.progress.open")}
        containerClassName="min-h-0 min-w-0 flex-1"
        className="flex flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-3 text-xs leading-4.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none"
      >
        {hasTicketTodos(step) ? (
          <PlanStatusTodos key={step.id} step={step} number={number} />
        ) : null}
        <section aria-label={t("plans.progress.step", { number })}>
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm leading-5 font-semibold wrap-anywhere">
                {t("plans.progress.step", { number })} · {step.name}
                {pass ? ` · ${t("plans.progress.pass", { pass })}` : null}
              </h3>
              <p className="text-xs leading-4.5 text-muted-foreground wrap-anywhere">
                {nodeKind(step, t)}
              </p>
            </div>
            <PlanStatusBadge
              status={step.status}
              isBlocked={step.isBlocked}
              hasOpenReport={hasOpenPlanReport(step)}
              className="rounded-sm px-1.5 py-0.5 text-[0.6875rem] leading-4"
            />
          </div>
          {kind && kind !== "actual" ? (
            <p className="text-xs leading-4.5 text-muted-foreground wrap-anywhere">
              {t(`plans.progress.outlook.${kind}`)}
            </p>
          ) : null}
          {hasOpenPlanReport(step) ? (
            <p className="text-xs leading-4.5 text-warning wrap-anywhere">
              {t("plans.progress.reportOpenHint")}
            </p>
          ) : null}
          {step.isBlocked && blockedByName ? (
            <p className="text-xs leading-4.5 text-destructive wrap-anywhere">
              {t("plans.progress.blockedBy", { name: blockedByName })}
            </p>
          ) : null}
          <PlanStatusStop stop={step.failureStop} />
          {step.isDisplayFiltered ? (
            <p className="text-xs text-muted-foreground">
              {t("plans.progress.filteredOutput")}
            </p>
          ) : null}
          <PlanStatusHistory step={step} />
          <PlanStatusReport acceptance={step.session?.acceptance} />
          <PlanScriptReport report={step.report} />
          <PlanExecutionDetails step={step} />
          <StepConfiguration step={step} end={end} />
          {hasAgentList ? <PlanStatusActivity step={step} /> : null}
          <PlanRemoteHistory step={step} />
          <Button
            size="sm"
            variant="ghost"
            className="mt-2 h-auto min-h-8 max-w-full justify-start rounded-md px-0 text-xs leading-4.5 text-muted-foreground whitespace-normal xl:min-h-8 xl:px-0 xl:text-xs [@media(pointer:coarse)]:min-h-11"
            onClick={onLocate}
            disabled={!canLocate}
          >
            <Crosshair aria-hidden="true" className="size-4 shrink-0" />
            {t(
              canLocate
                ? "plans.progress.locate"
                : "plans.progress.nodeMissing",
            )}
          </Button>
        </section>
      </ScrollViewport>
      {hasAgentList ? <PlanStatusAgentTodos step={step} /> : null}
    </div>
  );
}

function StepConfiguration({
  step,
  end,
}: Pick<StatusDetailsProps, "step" | "end">): React.ReactElement | null {
  const { t } = useTranslation();
  if (!step) return null;
  if (isPlanDecisionResult(step)) return null;
  if (step.script) return <PlanScriptRun step={step} />;
  if (isScript(step)) return <PlanRemoteScriptRun step={step} />;
  if (step.session)
    return (
      <>
        <PlanStatusRetry session={step.session} />
        <PlanStatusConfiguration
          session={step.session}
          end={end}
          isRunning={step.status === "running"}
        />
      </>
    );
  return (
    <p className="text-xs leading-4.5 text-muted-foreground">
      {t("plans.progress.noConfiguration")}
    </p>
  );
}
