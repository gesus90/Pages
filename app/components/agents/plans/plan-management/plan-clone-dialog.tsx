import { useId } from "react";
import { useTranslation } from "react-i18next";

import { planRequestError } from "./plan-context-model";
import { PlanDialogFrame } from "./plan-dialog-frame";
import { PlanSettingsTeams, PlanOwnerField } from "./plan-access-teams";
import {
  PlanSettingsName,
  PlanSettingsOptions,
  PlanSettingsContext,
} from "./plan-settings-fields";
import { usePlanCloneSettings } from "./use-plan-clone-settings";

import type { AgentPlanPage, AgentPlanView } from "@/definition/AgentPlan";
import type { usePlanManagement } from "./use-plan-management";

/** Copies the latest saved source; the server repairs context, names and unavailable references. */
export function PlanCloneDialog({
  page,
  source,
  isOneShot,
  management,
}: {
  readonly page: AgentPlanPage;
  readonly source: AgentPlanView;
  readonly isDirty: boolean;
  readonly isOneShot: boolean;
  readonly management: ReturnType<typeof usePlanManagement>;
}): React.ReactElement {
  const { t } = useTranslation();
  const searchId = useId();
  const { values, setValues, teams, ownerId, setOwnerId, request, key } =
    usePlanCloneSettings(page, source, isOneShot);
  return (
    <PlanDialogFrame
      title={t("plans.manage.cloneTitle")}
      description={t("plans.manage.cloneSource", { name: source.name })}
      submitLabel={t("plans.manage.clone")}
      isPending={management.isPending}
      isSubmitDisabled={false}
      isAlwaysEnabled
      error={planRequestError(management.error, t)}
      onSubmit={() => management.submit(request, key)}
      onClose={management.close}
    >
      <PlanSettingsName
        name={values.name}
        isReadOnly={management.isPending}
        onChange={(name) => setValues({ ...values, name })}
      />
      <PlanSettingsOptions page={page} values={values} teams={teams.teams}>
        <PlanSettingsTeams
          directory={page.directory}
          state={teams}
          isDisabled={management.isPending}
          canManage
          searchId={searchId}
        />
        <PlanSettingsContext
          page={page}
          values={values}
          onChange={setValues}
          isDisabled={management.isPending}
          isProjectFixed
          hasProject={false}
        />
        {source.rights?.isAdministrator ? (
          <PlanOwnerField
            page={page}
            ownerId={ownerId}
            isDisabled={management.isPending}
            onChange={setOwnerId}
          />
        ) : null}
      </PlanSettingsOptions>
    </PlanDialogFrame>
  );
}
