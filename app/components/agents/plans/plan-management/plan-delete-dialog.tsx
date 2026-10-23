import { useTranslation } from "react-i18next";

import { planRequestError } from "./plan-context-model";
import { PlanDialogFrame } from "./plan-dialog-frame";
import { useRequestKey } from "./use-plan-management";

import type { AgentPlanPage, AgentPlanView } from "@/definition/AgentPlan";
import type { usePlanManagement } from "./use-plan-management";

/**
 * A short confirmation before the plan is deleted: name, context, Abbrechen or Löschen.
 *
 * @remarks
 * The server checks again that the person owns the plan and that no run of
 * it is active; it deletes the revision shown here and nothing else. The
 * files of the workspace and the run history stay. Another plan opens
 * afterwards.
 */
export function PlanDeleteDialog({
  page,
  plan,
  isDirty,
  management,
}: {
  readonly page: AgentPlanPage;
  readonly plan: AgentPlanView;
  readonly isDirty: boolean;
  readonly management: ReturnType<typeof usePlanManagement>;
}): React.ReactElement {
  const { t } = useTranslation();
  const workspace = page.workspaces.find(
    (entry) => entry.id === plan.workspaceId,
  );
  const request = {
    intent: "delete-plan",
    planId: plan.id,
    revision: String(plan.revision),
  };
  const key = useRequestKey(JSON.stringify(request));
  const context = [plan.projectName, workspace?.name]
    .filter(Boolean)
    .join(" · ");
  return (
    <PlanDialogFrame
      title={t("plans.manage.deleteTitle")}
      description={t("plans.manage.deleteQuestion", { name: plan.name })}
      submitLabel={t("plans.manage.delete")}
      tone="destructive"
      hasCloseButton={false}
      isPending={management.isPending}
      isSubmitDisabled={false}
      error={planRequestError(management.error, t)}
      onSubmit={() => management.submit(request, key)}
      onClose={management.close}
    >
      <p className="text-xs text-muted-foreground">
        {t("plans.manage.deleteContext", { context })}
        {isDirty ? ` ${t("plans.manage.deleteUnsaved")}` : null}
      </p>
    </PlanDialogFrame>
  );
}
