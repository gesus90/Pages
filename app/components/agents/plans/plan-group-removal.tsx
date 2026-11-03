import { useTranslation } from "react-i18next";

import { planFrameUngroupNeedsRepair } from "@/definition/AgentPlanFrameSafety";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

import { findPlanGroupLocation } from "@/definition/AgentPlanLoopGroupEdit";

import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";
import type { AgentPlanInput } from "@/definition/AgentPlan";
import type { PlanGraphActions } from "./use-plan-graph";

/** The group or loop waiting for the removal choice, a group inside a loop included. */
function removalFrame(
  draft: AgentPlanInput,
  id: string | null,
): AgentPlanGroup | AgentPlanLoop | null {
  if (id === null) return null;
  const found =
    draft.nodes.find((node) => node.id === id) ??
    findPlanGroupLocation(draft, id)?.group;
  return found?.type === "group" || found?.type === "loop" ? found : null;
}

/**
 * Asks how a frame with members goes: the frame alone, or the frame with its members.
 *
 * @remarks
 * Neither choice is a default, so removing a group never deletes its members
 * by accident.
 */
export function PlanGroupRemoval(props: {
  readonly draft: AgentPlanInput;
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const { graph } = props;
  const frame = removalFrame(props.draft, graph.removalId);
  const kind = frame?.type === "loop" ? "loops" : "groups";
  const isOpen = frame !== null && props.canEdit;
  const name = frame?.name ?? "";
  const count = frame?.steps.length ?? 0;
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) graph.cancelRemoval();
      }}
    >
      <DialogContent className="space-y-4">
        <DialogTitle className="text-lg font-semibold">
          {t(`plans.${kind}.removeTitle`, { name })}
        </DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {t(`plans.${kind}.removeDescription`, { count })}
        </DialogDescription>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={graph.cancelRemoval}>
            {t("settings.agents.cancel")}
          </Button>
          <Button
            variant="outline"
            disabled={
              frame !== null &&
              planFrameUngroupNeedsRepair(props.draft, frame.id)
            }
            title={t("plans.groups.repairBeforeUngroup")}
            onClick={() => {
              if (graph.removalId) graph.removeGroup(graph.removalId, true);
            }}
          >
            {t(`plans.${kind}.removeFrame`)}
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (graph.removalId) graph.removeGroup(graph.removalId, false);
            }}
          >
            {t(`plans.${kind}.removeWithMembers`, { count })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
