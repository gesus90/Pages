import { useState } from "react";
import { useTranslation } from "react-i18next";

import { PlanContextFields } from "./plan-context-fields";
import {
  firstPlanLocation,
  isPlanNameUsed,
  planContextRequest,
  planLocationOptions,
  planLocationValue,
  planProjects,
  planRequestError,
} from "./plan-context-model";
import { PlanDialogFrame } from "./plan-dialog-frame";
import { useRequestKey } from "./use-plan-management";

import type { AgentPlanPage } from "@/definition/AgentPlan";
import type { PlanContextValues } from "./plan-context-model";
import type { usePlanManagement } from "./use-plan-management";

function initialValues(
  page: AgentPlanPage,
  translate: ReturnType<typeof useTranslation>["t"],
): PlanContextValues {
  const selected = page.selected;
  if (selected)
    return {
      name: "",
      projectId: selected.projectId,
      location: planLocationValue(selected),
    };
  const projectId = planProjects(page)[0]?.value ?? "";
  return {
    name: "",
    projectId,
    location: firstPlanLocation(
      planLocationOptions(page, projectId, translate),
    ),
  };
}

/**
 * Creates an empty plan with name, project and workspace; it starts no run.
 *
 * @remarks
 * The plan is stored only after Erstellen. It belongs to its creator and to
 * the creator's team, and opens in the editor once the server stored it.
 */
export function PlanCreateDialog({
  page,
  management,
}: {
  readonly page: AgentPlanPage;
  readonly management: ReturnType<typeof usePlanManagement>;
}): React.ReactElement {
  const { t } = useTranslation();
  const [values, setValues] = useState(() => initialValues(page, t));
  const request = planContextRequest(page, values, "");
  const key = useRequestKey(JSON.stringify(request));
  const isTaken = isPlanNameUsed(page, {
    name: values.name,
    projectId: values.projectId,
    departmentId: page.teamDepartmentId ?? null,
  });
  return (
    <PlanDialogFrame
      title={t("plans.manage.createTitle")}
      submitLabel={t("plans.manage.create")}
      isPending={management.isPending}
      isSubmitDisabled={request === null || isTaken}
      error={planRequestError(management.error, t)}
      onSubmit={() => {
        if (request)
          management.submit({ intent: "create-plan", ...request }, key);
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
    </PlanDialogFrame>
  );
}
