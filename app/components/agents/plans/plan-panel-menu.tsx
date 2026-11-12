import {
  Copy,
  History,
  MoreHorizontal,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { isActivePlanRun } from "@/definition/AgentPlanRunState";

import type { AgentPlanPage } from "@/definition/AgentPlan";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";
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
 * The plan menu behind ⋯: Neu, Bearbeiten, Klonen, Als Einmal-Plan kopieren and Entfernen.
 *
 * @remarks
 * Each entry opens a dialog and changes nothing by itself. An entry that is
 * not available names why; the server checks every request again.
 */
export function PlanPanelMenu(props: {
  readonly page: AgentPlanPage;
  readonly control: AgentPlanControl | undefined;
  readonly canEdit: boolean;
  readonly onOpen: (dialog: PlanManagementDialog) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { page } = props;
  const blocker = deleteBlocker(page, props.control);
  return (
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
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={blocker !== null}
          className="text-destructive data-highlighted:bg-destructive-subtle"
          onSelect={() => props.onOpen("delete")}
        >
          <Trash2 aria-hidden="true" className={ITEM_ICON_CLASS} />
          <span className="flex min-w-0 flex-col">
            {t("plans.manage.remove")}
            {blocker ? (
              <span className="text-xs text-muted-foreground">
                {t(blocker)}
              </span>
            ) : null}
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Teams und Besitzer, Verlauf and, for administrators, Skripte freigeben (PAGE-329). */
function PlanAccessMenuItems(props: {
  readonly page: AgentPlanPage;
  readonly onOpen: (dialog: PlanManagementDialog) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const plan = props.page.selected;
  const needsApproval =
    plan?.rights?.isAdministrator === true &&
    (plan.scriptApproval?.unapprovedStepIds.length ?? 0) > 0;
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
      {needsApproval ? (
        <DropdownMenuItem onSelect={() => props.onOpen("approve-scripts")}>
          <ShieldCheck aria-hidden="true" className={ITEM_ICON_CLASS} />
          {t("plans.access.approveMenu")}
        </DropdownMenuItem>
      ) : null}
    </>
  );
}
