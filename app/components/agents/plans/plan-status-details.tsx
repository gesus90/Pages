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
      <p className="p-6 text-sm text-muted-foreground">
        {t("plans.progress.noSelection")}
      </p>
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto border-t border-border/80 px-5 py-4 @3xl:grid @3xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] @3xl:gap-0 @3xl:overflow-hidden @3xl:px-9">
      <div className="min-w-0 shrink-0 pr-1 @3xl:min-h-0 @3xl:overflow-y-auto @3xl:border-r @3xl:border-border/80 @3xl:pr-9">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold wrap-anywhere @3xl:text-2xl">
              {t("plans.progress.step", { number })} · {step.name}
            </h3>
            <p className="text-sm text-muted-foreground wrap-anywhere">
              {t("plans.progress.agent", { name: step.name })}
            </p>
          </div>
          <span className="shrink-0 [&>span]:rounded-md [&>span]:px-3 [&>span]:py-1.5 [&>span]:text-sm">
            <PlanStatusBadge status={step.status} isBlocked={step.isBlocked} />
          </span>
        </div>
        {step.session ? (
          <PlanStatusConfiguration
            session={step.session}
            end={end}
            isRunning={step.status === "running"}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("plans.progress.noConfiguration")}
          </p>
        )}
        <PlanStatusActivity step={step} />
        <Button
          size="sm"
          variant="ghost"
          className="mt-2 h-auto min-h-0 max-w-full justify-start px-0 py-0.5 text-sm text-muted-foreground whitespace-normal xl:min-h-0 xl:text-sm [@media(pointer:coarse)]:min-h-11"
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
