import { Crosshair } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ScrollViewport } from "@/app/components/ui/scroll-viewport";
import { Button } from "@/app/components/ui/button";

import { PlanExecutionDetails } from "./plan-execution-details";
import { PlanStatusActivity } from "./plan-status-activity";
import { hasOpenPlanReport, PlanStatusBadge } from "./plan-status";
import { PlanStatusConfiguration } from "./plan-status-configuration";
import { PlanStatusTodos } from "./plan-status-todos";
import { PlanScriptRun } from "./plan-script-run";
import { PlanRemoteScriptRun } from "./plan-remote-script-run";
import { PlanStatusRetry } from "./plan-status-retry";
import { PlanRemoteHistory } from "./plan-remote-history";
import { PlanStatusReport } from "./plan-status-report";
import { PlanScriptReport } from "./plan-script/plan-script-report";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";

interface StatusDetailsProps {
  readonly step: AgentPlanStepResult | undefined;
  readonly blockedByName?: string | null;
  readonly number: number;
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

/** Consistent run-step details, with honest empty states when the runner reports no live activity. */
export function PlanStatusDetails({
  step,
  blockedByName,
  number,
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
  return (
    <ScrollViewport
      axis="vertical"
      tabIndex={0}
      role="region"
      aria-label={t("plans.progress.open")}
      containerClassName="min-h-0 flex-1"
      className="flex flex-col gap-4 overflow-y-auto overscroll-contain border-t border-border/80 px-4 py-3 text-xs leading-4.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none"
    >
      {isScript(step) ? null : (
        <PlanStatusTodos key={step.id} step={step} number={number} />
      )}
      <ScrollViewport
        axis="vertical"
        tabIndex={0}
        role="region"
        aria-label={t("plans.progress.step", { number })}
        containerClassName="min-w-0 shrink-0"
        className="overflow-visible overscroll-contain pr-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm leading-5 font-semibold wrap-anywhere">
              {t("plans.progress.step", { number })} · {step.name}
            </h3>
            <p className="text-xs leading-4.5 text-muted-foreground wrap-anywhere">
              {isScript(step)
                ? t("plans.nodeType.script")
                : t("plans.progress.agent", { name: step.name })}
            </p>
          </div>
          <PlanStatusBadge
            status={step.status}
            isBlocked={step.isBlocked}
            hasOpenReport={hasOpenPlanReport(step)}
            className="rounded-sm px-1.5 py-0.5 text-[0.6875rem] leading-4"
          />
        </div>
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
        {step.isDisplayFiltered ? (
          <p className="text-xs text-muted-foreground">
            {t("plans.progress.filteredOutput")}
          </p>
        ) : null}
        <PlanStatusReport acceptance={step.session?.acceptance} />
        <PlanScriptReport report={step.report} />
        <PlanExecutionDetails step={step} />
        <StepConfiguration step={step} end={end} />
        {isScript(step) ? null : <PlanStatusActivity step={step} />}
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
            canLocate ? "plans.progress.locate" : "plans.progress.nodeMissing",
          )}
        </Button>
      </ScrollViewport>
    </ScrollViewport>
  );
}

function StepConfiguration({
  step,
  end,
}: Pick<StatusDetailsProps, "step" | "end">): React.ReactElement | null {
  const { t } = useTranslation();
  if (!step) return null;
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
