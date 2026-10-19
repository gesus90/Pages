import { Crosshair } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import { PlanStatusActivity } from "./plan-status-activity";
import { PlanStatusBadge } from "./plan-status";
import { PlanStatusConfiguration } from "./plan-status-configuration";
import { PlanStatusTodos } from "./plan-status-todos";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";

interface StatusDetailsProps {
  readonly step: AgentPlanStepResult | undefined;
  readonly number: number;
  readonly end: string | null;
  readonly canLocate: boolean;
  readonly onLocate: () => void;
}

/** Consistent run-step details, with honest empty states when the runner reports no live activity. */
export function PlanStatusDetails({
  step,
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
    <div
      tabIndex={0}
      role="region"
      aria-label={t("plans.progress.open")}
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain border-t border-border/80 px-4 py-3 text-xs leading-4.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none @2xl/status:grid @2xl/status:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] @2xl/status:overflow-hidden"
    >
      <div
        tabIndex={0}
        role="region"
        aria-label={t("plans.progress.step", { number })}
        className="min-w-0 shrink-0 overscroll-contain pr-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none @2xl/status:min-h-0 @2xl/status:overflow-y-auto @2xl/status:border-r @2xl/status:border-border/80 @2xl/status:pr-4"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm leading-5 font-semibold wrap-anywhere">
              {t("plans.progress.step", { number })} · {step.name}
            </h3>
            <p className="text-xs leading-4.5 text-muted-foreground wrap-anywhere">
              {t("plans.progress.agent", { name: step.name })}
            </p>
          </div>
          <PlanStatusBadge
            status={step.status}
            isBlocked={step.isBlocked}
            className="rounded-sm px-1.5 py-0.5 text-[0.6875rem] leading-4"
          />
        </div>
        {step.session ? (
          <PlanStatusConfiguration
            session={step.session}
            end={end}
            isRunning={step.status === "running"}
          />
        ) : (
          <p className="text-xs leading-4.5 text-muted-foreground">
            {t("plans.progress.noConfiguration")}
          </p>
        )}
        <PlanStatusActivity step={step} />
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
      </div>
      <PlanStatusTodos key={step.id} step={step} number={number} />
    </div>
  );
}
