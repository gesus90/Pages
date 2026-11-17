import { useTranslation } from "react-i18next";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

import { PlanWorkspaceLocks } from "./plan-workspace-locks";

import type { AgentPlanControl } from "@/definition/AgentPlanControl";
import type { AgentPlanWorkspaceLock } from "@/definition/AgentPlanWorkspaceLock";

/** The reservations the reader may release now; the menu entry exists only while there are any. */
export function releasableWorkspaceLocks(
  control: AgentPlanControl | undefined,
): readonly AgentPlanWorkspaceLock[] {
  return (control?.workspaceLocks ?? []).filter((entry) => entry.canRelease);
}

/**
 * „Arbeitsbereich freigeben“ of the plan menu.
 * @remarks
 * It shows the same holders and the same checked release as the notice under
 * the heading; nothing is released by opening or closing the dialog.
 */
export function PlanWorkspaceReleaseDialog({
  entries,
  onClose,
}: {
  readonly entries: readonly AgentPlanWorkspaceLock[];
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
      <DialogContent size="md" className="pb-4">
        <DialogTitle className="text-lg font-semibold">
          {t("plans.workspaceLocks.menu")}
        </DialogTitle>
        <DialogDescription className="mt-2 text-sm text-muted-foreground">
          {t("plans.workspaceLocks.dialogDescription")}
        </DialogDescription>
        <div className="-mx-4 pb-2">
          <PlanWorkspaceLocks entries={entries} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
