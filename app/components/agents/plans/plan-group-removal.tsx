import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

import type { AgentPlanInput } from "@/definition/AgentPlan";
import type { PlanGraphActions } from "./use-plan-graph";

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
  const group = props.draft.nodes.find((node) => node.id === graph.removalId);
  const isOpen = group?.type === "group" && props.canEdit;
  const name = group?.type === "group" ? group.name : "";
  const count = group?.type === "group" ? group.steps.length : 0;
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) graph.cancelRemoval();
      }}
    >
      <DialogContent className="space-y-4">
        <DialogTitle className="text-lg font-semibold">
          {t("plans.groups.removeTitle", { name })}
        </DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {t("plans.groups.removeDescription", { count })}
        </DialogDescription>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={graph.cancelRemoval}>
            {t("settings.agents.cancel")}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              if (graph.removalId) graph.removeGroup(graph.removalId, true);
            }}
          >
            {t("plans.groups.removeFrame")}
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (graph.removalId) graph.removeGroup(graph.removalId, false);
            }}
          >
            {t("plans.groups.removeWithMembers", { count })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
