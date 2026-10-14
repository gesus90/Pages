import { Unlink } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import { planLinkPoints } from "./plan-layout";
import { planLinkKey, planLinkLabel, planLinks } from "./plan-links";

import type { AgentPlanInput, AgentPlanSources } from "@/definition/AgentPlan";
import type { PlanGraphActions } from "./use-plan-graph";

/** The selected connection offers its removal right on its line, in grid coordinates. */
export function PlanLinkAction(props: {
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const selected = props.graph.selectedLink;
  const key = selected ? planLinkKey(selected) : null;
  const link = planLinks(props.draft).find(
    (entry) => planLinkKey(entry) === key,
  );
  const points = link ? planLinkPoints(props.draft, props.sources, link) : null;
  if (!link || !points) return null;
  return (
    <Button
      size="xs"
      variant="destructive-soft"
      className="absolute z-10 -translate-x-1/2 -translate-y-1/2 bg-surface shadow-xs"
      style={{
        left: (points.x1 + points.x2) / 2,
        top: (points.y1 + points.y2) / 2,
      }}
      disabled={!props.canEdit}
      aria-label={t("plans.removeLink", {
        name: planLinkLabel(props.draft, props.sources, link),
      })}
      onClick={() => props.graph.disconnect(link)}
    >
      <Unlink className="size-4" aria-hidden="true" />
      {t("plans.unlink")}
    </Button>
  );
}
