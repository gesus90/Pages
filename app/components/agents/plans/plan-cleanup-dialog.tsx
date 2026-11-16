import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

import { PlanResourceReleases } from "./plan-resource-releases";
import { PlanWorkspaceCleanup } from "./plan-workspace-cleanup";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";

/**
 * Whether the plan has cleanups to decide or a forced-release history to read.
 * @param control - The control state of the plan.
 * @param run - The run the canvas shows.
 */
export function hasPlanCleanups(
  control: AgentPlanControl | undefined,
  run: AgentPlanRun | null,
): boolean {
  return (
    Boolean(control?.cleanup?.length) ||
    Boolean(run?.resourceReleases?.length) ||
    Boolean(run?.startCleanupUnconfirmed?.length)
  );
}

/**
 * „Bereinigungen“ of the plan menu: pending workspace cleanups with their
 * decisions and the forced-release history of the shown run.
 * @remarks
 * Moved out of the expanded panel so it stays short; nothing here is
 * decided by opening or closing the dialog. A cleanup counts as done only
 * after its explicit release, which the server checks again.
 */
export function PlanCleanupDialog({
  planId,
  control,
  run,
  onClose,
}: {
  readonly planId: string;
  readonly control: AgentPlanControl | undefined;
  readonly run: AgentPlanRun | null;
  readonly onClose: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent size="md" className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            <DialogTitle className="text-lg font-semibold">
              {t("plans.manage.cleanupTitle")}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {t("plans.manage.cleanupDescription")}
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t("plans.manage.close")}
            >
              <X aria-hidden="true" className="size-4" />
            </Button>
          </DialogClose>
        </div>
        <div data-plan-cleanup-dialog="" className="-mx-4 space-y-2 pb-2">
          <PlanWorkspaceCleanup
            entries={control?.cleanup ?? []}
            planId={planId}
          />
          <PlanResourceReleases run={run} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
