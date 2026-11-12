import { useTranslation } from "react-i18next";

import { planRequestError } from "./plan-context-model";
import { PlanDialogFrame } from "./plan-dialog-frame";
import { useRequestKey } from "./use-plan-management";

import type { AgentPlanView } from "@/definition/AgentPlan";
import type { usePlanManagement } from "./use-plan-management";

/** The names of the script steps that wait for an approval. */
function pendingScriptNames(plan: AgentPlanView): readonly string[] {
  const pending = new Set(plan.scriptApproval?.unapprovedStepIds ?? []);
  return plan.nodes.flatMap((node) =>
    node.type === "script" && pending.has(node.id) ? [node.name] : [],
  );
}

/**
 * An administrator approves the current content of the plan's script steps (PAGE-329, part C).
 *
 * @remarks
 * The approval is bound to the hash of script, interpreter profile and
 * workspace. Team members with the right to run may start the plan until a
 * script changes; the history records who approved which hash.
 */
export function PlanScriptApprovalDialog({
  plan,
  management,
}: {
  readonly plan: AgentPlanView;
  readonly management: ReturnType<typeof usePlanManagement>;
}): React.ReactElement {
  const { t } = useTranslation();
  const request = {
    intent: "approve-plan-scripts",
    planId: plan.id,
    revision: String(plan.revision),
  };
  const key = useRequestKey(JSON.stringify(request));
  const names = pendingScriptNames(plan);
  return (
    <PlanDialogFrame
      title={t("plans.access.approveTitle")}
      description={t("plans.access.approveQuestion", { name: plan.name })}
      submitLabel={t("plans.access.approve")}
      isPending={management.isPending}
      isSubmitDisabled={names.length === 0}
      error={planRequestError(management.error, t)}
      onSubmit={() => management.submit(request, key)}
      onClose={management.close}
    >
      <ul className="list-disc space-y-1 pl-5 text-xs" data-plan-approval-steps>
        {names.map((name) => (
          <li key={name} className="wrap-anywhere">
            {name}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        {t("plans.access.approveHint")}
      </p>
    </PlanDialogFrame>
  );
}
