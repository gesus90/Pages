import { useTranslation } from "react-i18next";

import { ScrollViewport } from "@/app/components/ui/scroll-viewport";

import { planNodeLabel } from "../plan-layout";
import { PlanStatusBadge } from "../plan-status";

import type { AgentPlanRun, AgentPlanSources } from "@/definition/AgentPlan";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";

/**
 * A group shows its members; the reader picks the agent step whose session opens.
 *
 * @remarks
 * Members share one process, never an attempt, so no session is assigned to
 * the group itself.
 */
export function ConsoleGroup({
  group,
  sources,
  run,
  onPick,
}: {
  readonly group: AgentPlanGroup;
  readonly sources: AgentPlanSources;
  readonly run: AgentPlanRun | null;
  readonly onPick: (stepId: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <ScrollViewport
      axis="vertical"
      containerClassName="min-h-0 flex-1"
      className="overflow-y-auto px-5 py-4"
    >
      <p className="mb-3 text-sm text-muted-foreground">
        {t("plans.console.pickMember")}
      </p>
      {group.steps.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("plans.console.noMembers")}
        </p>
      ) : (
        <ul className="space-y-2">
          {group.steps.map((step) => {
            const result = run?.steps.find((entry) => entry.id === step.id);
            const label =
              planNodeLabel(step, sources) || t("plans.missingAgent");
            return (
              <li key={step.id}>
                <button
                  type="button"
                  onClick={() => onPick(step.id)}
                  className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
                >
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  {result ? (
                    <PlanStatusBadge
                      compact
                      status={result.status}
                      isBlocked={result.isBlocked}
                    />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </ScrollViewport>
  );
}
