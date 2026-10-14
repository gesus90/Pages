import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

import type { AgentPlanActionResult } from "@/app/lib/agent-plan-response";
import type { AgentPlanView } from "@/definition/AgentPlan";

/**
 * Confirms deleting the selected plan; the server checks the right again and returns to the plan list.
 *
 * @remarks
 * Only those who may edit the plan, its owner, see the action at all.
 */
export function PlanDelete(props: {
  readonly plan: AgentPlanView;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const fetcher = useFetcher<AgentPlanActionResult>();
  const [isOpen, setOpen] = useState(false);
  const isPending = fetcher.state !== "idle";
  const failure = fetcher.data?.ok === false ? fetcher.data.error : null;
  if (!props.plan.canEdit) return null;
  function changeOpen(open: boolean): void {
    if (!isPending) setOpen(open);
  }
  return (
    <>
      <Button
        size="sm"
        variant="destructive-soft"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-4" aria-hidden="true" />
        {t("plans.deletePlan")}
      </Button>
      <Dialog open={isOpen} onOpenChange={changeOpen}>
        <DialogContent size="md">
          <DialogTitle className="text-lg font-semibold">
            {t("plans.deleteTitle", { name: props.plan.name })}
          </DialogTitle>
          <DialogDescription className="mt-1.5 text-sm text-muted-foreground">
            {t("plans.deleteDescription")}
          </DialogDescription>
          {failure ? (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {t(`settings.agents.error.${failure}`, {
                defaultValue: t(`assistant.error.${failure}`),
              })}
            </p>
          ) : null}
          <fetcher.Form
            method="post"
            action="/agents/plans"
            className="mt-6 flex justify-end gap-2"
          >
            <input type="hidden" name="intent" value="delete-plan" />
            <input type="hidden" name="planId" value={props.plan.id} />
            <Button
              type="button"
              variant="ghost"
              disabled={isPending}
              onClick={() => changeOpen(false)}
            >
              {t("settings.agents.cancel")}
            </Button>
            <Button type="submit" variant="destructive" disabled={isPending}>
              {t("plans.confirmDelete")}
            </Button>
          </fetcher.Form>
        </DialogContent>
      </Dialog>
    </>
  );
}
