import { useState } from "react";
import { useTranslation } from "react-i18next";

import { PlanContextFields } from "./plan-context-fields";
import {
  isPlanNameUsed,
  planContextRequest,
  planLocationValue,
  planRequestError,
} from "./plan-context-model";
import { PlanDialogFrame } from "./plan-dialog-frame";
import { useRequestKey } from "./use-plan-management";

import type { AgentPlanPage, AgentPlanView } from "@/definition/AgentPlan";
import type { usePlanManagement } from "./use-plan-management";

/**
 * Copies the saved revision of the plan into a new, independent plan.
 *
 * @remarks
 * The copy takes every node with groups, loops, settings, positions and
 * connections under new identifiers; runs, checkpoints, sessions, processes
 * and workspace files stay with the source, which does not change. Unsaved
 * edits of the editor are neither copied nor saved and stay in the editor.
 * No run starts.
 */
export function PlanCloneDialog({
  page,
  source,
  isDirty,
  management,
}: {
  readonly page: AgentPlanPage;
  readonly source: AgentPlanView;
  readonly isDirty: boolean;
  readonly management: ReturnType<typeof usePlanManagement>;
}): React.ReactElement {
  const { t } = useTranslation();
  const [values, setValues] = useState(() => ({
    name: t("plans.manage.cloneName", { name: source.name }).slice(0, 120),
    projectId: source.projectId,
    location: planLocationValue(source),
  }));
  const context = planContextRequest(page, values);
  const request = context && {
    intent: "clone-plan",
    planId: source.id,
    revision: String(source.revision),
    ...context,
  };
  const key = useRequestKey(JSON.stringify(request));
  const isTaken = isPlanNameUsed(page, {
    name: values.name,
    projectId: values.projectId,
    departmentId: page.teamDepartmentId ?? null,
  });
  return (
    <PlanDialogFrame
      title={t("plans.manage.cloneTitle")}
      description={t("plans.manage.cloneSource", {
        name: source.name,
        revision: source.revision,
      })}
      submitLabel={t("plans.manage.clone")}
      isPending={management.isPending}
      isSubmitDisabled={request === null || isTaken}
      error={planRequestError(management.error, t)}
      onSubmit={() => {
        if (request) management.submit(request, key);
      }}
      onClose={management.close}
    >
      <PlanContextFields
        page={page}
        values={values}
        onChange={setValues}
        isDisabled={management.isPending}
        isProjectFixed={false}
        nameError={isTaken ? t("settings.agents.error.plan_name_taken") : null}
      />
      {isDirty ? (
        <p role="note" className="text-xs text-muted-foreground">
          {t("plans.manage.cloneUnsaved")}
        </p>
      ) : null}
    </PlanDialogFrame>
  );
}
