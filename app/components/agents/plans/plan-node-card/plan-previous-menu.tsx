import { History } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { planLoopOf } from "@/definition/AgentPlanLoop";

import { usePlanFlowContext } from "../plan-flow-context";
import { planNodeLabel } from "../plan-layout";

import type { AgentPlanLoopMember } from "@/definition/AgentPlanLoop";

/**
 * Lets an input of a loop member take the result a member had in the previous iteration.
 *
 * @remarks
 * Only the newest earlier result is handed over, so nothing accumulates. The
 * first iteration has no such result: the input then uses its own default,
 * which the plan check requires. Outside a loop the control is absent.
 */
export function PlanPreviousMenu(props: {
  readonly step: AgentPlanLoopMember;
  readonly parameter: string;
  readonly label: string;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { draft, sources, graph, canEdit } = usePlanFlowContext();
  const loop = planLoopOf(draft, props.step.id);
  if (!loop) return null;
  const title = t("plans.loops.previousChoose");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          className="nodrag nopan size-7 min-h-7 shrink-0 text-muted-foreground"
          disabled={!canEdit}
          aria-label={`${title}: ${props.parameter} · ${props.label}`}
          title={title}
        >
          <History className="size-3.5" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onKeyDown={(event) => event.stopPropagation()}
      >
        {loop.steps.map((member) => (
          <DropdownMenuItem
            key={member.id}
            onSelect={() =>
              graph.replaceNode({
                ...props.step,
                bindings: {
                  ...props.step.bindings,
                  [props.parameter]: { kind: "previous", stepId: member.id },
                },
              })
            }
          >
            {t("plans.loops.previousOf", {
              name: planNodeLabel(member, sources),
            })}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
