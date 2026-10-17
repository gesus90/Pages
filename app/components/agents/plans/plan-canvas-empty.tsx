import { useTranslation } from "react-i18next";

import { DEFAULT_PLAN_NAME } from "@/app/lib/agent-plan-default";

import type { AgentPlanOpening } from "@/app/lib/agent-plan-default";

function useEmptyText(
  opening: AgentPlanOpening,
  isEmptyPlan: boolean,
): { readonly title: string; readonly hint?: string } | null {
  const { t } = useTranslation();
  if (opening === "defaultMissing")
    return {
      title: t("plans.opening.defaultMissingTitle"),
      hint: t("plans.opening.defaultMissing", { name: DEFAULT_PLAN_NAME }),
    };
  if (opening === "requestedMissing")
    return {
      title: t("plans.opening.requestedMissingTitle"),
      hint: t("plans.opening.requestedMissing"),
    };
  return isEmptyPlan ? { title: t("plans.opening.emptyPlan") } : null;
}

/**
 * Says why the canvas shows no node: no plan could be opened, or the plan has none.
 *
 * @remarks
 * It lies over the canvas without taking pointer input, so the empty canvas
 * still pans and zooms.
 */
export function PlanCanvasEmpty(props: {
  readonly opening: AgentPlanOpening;
  readonly isEmptyPlan: boolean;
}): React.ReactElement | null {
  const text = useEmptyText(props.opening, props.isEmptyPlan);
  if (!text) return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8">
      <div
        role="status"
        className="max-w-sm rounded-2xl bg-background/80 px-5 py-4 text-center"
      >
        <p className="text-sm font-semibold">{text.title}</p>
        {text.hint ? (
          <p className="mt-1 text-sm text-muted-foreground">{text.hint}</p>
        ) : null}
      </div>
    </div>
  );
}
