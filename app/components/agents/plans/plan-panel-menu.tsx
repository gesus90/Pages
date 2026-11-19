import {
  BrushCleaning,
  Copy,
  History,
  LockOpen,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { isActivePlanRun } from "@/definition/AgentPlanRunState";

import { hasPlanCleanups, PlanCleanupDialog } from "./plan-cleanup-dialog";
import { PlanWorkspaceLocks } from "./plan-workspace-locks";

import type { AgentPlanPage, AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";
import type { AgentPlanWorkspaceLock } from "@/definition/AgentPlanWorkspaceLock";
import type { PlanManagementDialog } from "./plan-management/use-plan-management";

const ITEM_ICON_CLASS = "mr-2.5 size-4 shrink-0";

/** Why the plan cannot be deleted now, as a translation key, or `null`. */
function deleteBlocker(
  page: AgentPlanPage,
  control: AgentPlanControl | undefined,
): string | null {
  if (!page.selected) return "plans.manage.noPlan";
  const canDelete =
    page.selected.rights?.canDelete ?? page.selected.ownerId === page.userId;
  if (!canDelete) return "plans.manage.ownerOnly";
  if (control && control.status !== "idle" && isActivePlanRun(control.status))
    return "plans.manage.runActive";
  return null;
}

/**
 * The plan menu behind ⋯: Neu, Bearbeiten, Klonen, Als Einmal-Plan kopieren, Arbeitsbereich freigeben and Entfernen.
 * @remarks
 * While cleanups or forced releases of the plan exist, Bereinigungen opens
 * them with their decisions; the expanded panel does not repeat them.
 * Each entry opens a dialog and changes nothing by itself. An entry that is
 * not available names why; the server checks every request again.
 */
export function PlanPanelMenu(props: {
  readonly page: AgentPlanPage;
  readonly control: AgentPlanControl | undefined;
  readonly canEdit: boolean;
  readonly onOpen: (dialog: PlanManagementDialog) => void;
  /** The run the canvas shows, whose forced releases Bereinigungen lists. */
  readonly run: AgentPlanRun | null;
}): React.ReactElement {
  const { t } = useTranslation();
  const { page } = props;
  const [isCleanupOpen, setCleanupOpen] = useState(false);
  const [isReleaseOpen, setReleaseOpen] = useState(false);
  const releasable = releasableWorkspaceLocks(props.control);
  const blocker = deleteBlocker(page, props.control);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon-sm"
            variant="ghost"
            className="size-9 min-h-9 xl:min-h-9 [@media(pointer:coarse)]:size-11"
            aria-label={t("plans.manage.menu")}
          >
            <MoreHorizontal aria-hidden="true" className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuItem
            disabled={page.workspaces.length === 0}
            onSelect={() => props.onOpen("create")}
          >
            <Plus aria-hidden="true" className={ITEM_ICON_CLASS} />
            {t("plans.manage.new")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!page.selected || !props.canEdit}
            onSelect={() => props.onOpen("edit")}
          >
            <Pencil aria-hidden="true" className={ITEM_ICON_CLASS} />
            {t("plans.manage.edit")}
          </DropdownMenuItem>
          <PlanAccessMenuItems page={page} onOpen={props.onOpen} />
          <DropdownMenuItem
            disabled={!page.selected}
            onSelect={() => props.onOpen("clone")}
          >
            <Copy aria-hidden="true" className={ITEM_ICON_CLASS} />
            {t("plans.manage.cloneItem")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!page.selected}
            onSelect={() => props.onOpen("clone-one-shot")}
          >
            <Copy aria-hidden="true" className={ITEM_ICON_CLASS} />
            {t("plans.manage.cloneOneShotItem")}
          </DropdownMenuItem>
          {hasPlanCleanups(props.control, props.run) ? (
            <DropdownMenuItem
              onSelect={() => setCleanupOpen(true)}
              data-plan-cleanups
            >
              <BrushCleaning aria-hidden="true" className={ITEM_ICON_CLASS} />
              {t("plans.manage.cleanupMenu", {
                count: props.control?.cleanup?.length ?? 0,
              })}
            </DropdownMenuItem>
          ) : null}
          {releasable.length > 0 ? (
            <DropdownMenuItem
              onSelect={() => setReleaseOpen(true)}
              data-plan-workspace-release
            >
              <LockOpen aria-hidden="true" className={ITEM_ICON_CLASS} />
              {t("plans.workspaceLocks.menu")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <PlanDeleteMenuItem blocker={blocker} onOpen={props.onOpen} />
        </DropdownMenuContent>
      </DropdownMenu>
      {isReleaseOpen && releasable.length > 0 ? (
        <PlanWorkspaceReleaseDialog
          entries={releasable}
          onClose={() => setReleaseOpen(false)}
        />
      ) : null}
      {isCleanupOpen && page.selected ? (
        <PlanCleanupDialog
          planId={page.selected.id}
          control={props.control}
          run={props.run}
          onClose={() => setCleanupOpen(false)}
        />
      ) : null}
    </>
  );
}

/** Teams, owner and history of the selected plan. */
function PlanAccessMenuItems(props: {
  readonly page: AgentPlanPage;
  readonly onOpen: (dialog: PlanManagementDialog) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const plan = props.page.selected;
  return (
    <>
      <DropdownMenuItem
        disabled={!plan}
        onSelect={() => props.onOpen("access")}
      >
        <Users aria-hidden="true" className={ITEM_ICON_CLASS} />
        {t("plans.access.menu")}
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={!plan}
        onSelect={() => props.onOpen("history")}
      >
        <History aria-hidden="true" className={ITEM_ICON_CLASS} />
        {t("plans.access.historyMenu")}
      </DropdownMenuItem>
    </>
  );
}

/** Entfernen, which names why it is not available now. */
function PlanDeleteMenuItem(props: {
  readonly blocker: string | null;
  readonly onOpen: (dialog: PlanManagementDialog) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <DropdownMenuItem
      disabled={props.blocker !== null}
      className="text-destructive data-highlighted:bg-destructive-subtle"
      onSelect={() => props.onOpen("delete")}
    >
      <Trash2 aria-hidden="true" className={ITEM_ICON_CLASS} />
      <span className="flex min-w-0 flex-col">
        {t("plans.manage.remove")}
        {props.blocker ? (
          <span className="text-xs text-muted-foreground">
            {t(props.blocker)}
          </span>
        ) : null}
      </span>
    </DropdownMenuItem>
  );
}

function releasableWorkspaceLocks(
  control: AgentPlanControl | undefined,
): readonly AgentPlanWorkspaceLock[] {
  return (control?.workspaceLocks ?? []).filter((entry) => entry.canRelease);
}

function PlanWorkspaceReleaseDialog({
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
