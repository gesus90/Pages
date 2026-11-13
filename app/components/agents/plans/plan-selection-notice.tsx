import { CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { planPendingSelections } from "@/definition/AgentPlanSelection";

import type { PlanCanvasProps } from "./plan-flow-context";

/** Opens the first repaired step directly in the editor; there is no intermediate dialog. */
export function PlanSelectionNotice({
  canvas,
}: {
  readonly canvas: PlanCanvasProps;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const pending = planPendingSelections(canvas.draft);
  const first = pending[0];
  if (!first) return null;
  function openFirst(): void {
    if (!first) return;
    canvas.graph.select(first.id);
    canvas.onEdit?.(first.id);
  }
  return (
    <div
      role="status"
      className="pointer-events-auto flex h-11 w-full shrink-0 items-center gap-2 bg-primary-subtle px-4 text-sm"
    >
      <CircleAlert
        aria-hidden="true"
        className="size-4 shrink-0 text-primary"
      />
      <p>
        <strong>
          {t("plans.manage.selectionSteps", { count: pending.length })}
        </strong>{" "}
        {t("plans.manage.selectionNeeded")}
      </p>
      <button
        type="button"
        className="ml-auto shrink-0 text-primary underline-offset-2 hover:underline"
        onClick={openFirst}
      >
        {t("plans.manage.selectionFirst")}
      </button>
    </div>
  );
}
