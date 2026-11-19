import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { suggestOneShotCopyName } from "@/definition/AgentPlanOneShot";
import { isActivePlanRun } from "@/definition/AgentPlanRunState";
import { fullPlanTeam } from "@/definition/AgentPlanTeam";

import { PlanAccessDialog } from "./plan-access-dialog";
import { PlanOwnerField, PlanSettingsTeams } from "./plan-access-teams";
import {
  planLocationFields,
  planLocationValue,
  planRequestError,
} from "./plan-context-model";
import { hasPlanTeamRight } from "./plan-access-model";
import { PlanCreateDialog } from "./plan-create-dialog";
import { PlanDialogFrame } from "./plan-dialog-frame";
import { PlanEditDialog } from "./plan-edit-dialog";
import { PlanHistoryDialog } from "./plan-history-dialog";
import {
  PlanSettingsContext,
  PlanSettingsName,
  PlanSettingsOptions,
} from "./plan-settings-fields";
import { useRequestKey } from "./use-plan-management";
import { usePlanTeams } from "./use-plan-teams";

import type { AgentPlanPage, AgentPlanView } from "@/definition/AgentPlan";
import type { usePlanEditor } from "../use-plan-editor";
import type { PlanContextValues } from "./plan-context-model";
import type {
  PlanManagementRequest,
  usePlanManagement,
} from "./use-plan-management";

/** The one dialog of the plan menu that is open, if any. */
export function PlanManagementDialogs({
  page,
  editor,
  management,
}: {
  readonly page: AgentPlanPage;
  readonly editor: ReturnType<typeof usePlanEditor>;
  readonly management: ReturnType<typeof usePlanManagement>;
}): React.ReactElement | null {
  const plan = page.selected;
  if (management.dialog === "create")
    return <PlanCreateDialog page={page} management={management} />;
  if (!plan) return null;
  if (management.dialog === "edit")
    return (
      <PlanEditDialog
        page={page}
        plan={plan}
        editor={editor}
        management={management}
      />
    );
  if (management.dialog === "clone" || management.dialog === "clone-one-shot")
    return (
      <PlanCloneDialog
        page={page}
        source={plan}
        isDirty={editor.isDirty}
        isOneShot={management.dialog === "clone-one-shot"}
        management={management}
      />
    );
  if (management.dialog === "access")
    return <PlanAccessDialog page={page} plan={plan} management={management} />;
  if (management.dialog === "history")
    return <PlanHistoryDialog plan={plan} management={management} />;
  if (management.dialog === "delete")
    return (
      <PlanDeleteDialog
        page={page}
        plan={plan}
        isDirty={editor.isDirty}
        management={management}
      />
    );
  return null;
}

interface PlanCloneSettings {
  readonly values: PlanContextValues;
  readonly setValues: (values: PlanContextValues) => void;
  readonly teams: ReturnType<typeof usePlanTeams>;
  readonly ownerId: string;
  readonly setOwnerId: (ownerId: string) => void;
  readonly request: PlanManagementRequest;
  readonly key: string;
}

function usePlanCloneSettings(
  page: AgentPlanPage,
  source: AgentPlanView,
  isOneShot: boolean,
): PlanCloneSettings {
  const { t } = useTranslation();
  const [values, setValues] = useState(() => ({
    name: isOneShot
      ? suggestOneShotCopyName(
          source.name,
          t("plans.manage.cloneOneShotLabel"),
          new Date(),
        )
      : t("plans.manage.cloneName", { name: source.name }).slice(0, 120),
    projectId: source.projectId,
    location: planLocationValue(source),
  }));
  const teams = usePlanTeams(
    page.directory,
    page.teamDepartmentId
      ? [fullPlanTeam("department", page.teamDepartmentId)]
      : [],
  );
  const [ownerId, setOwnerId] = useState(page.userId);
  const fields = planLocationFields(page, values);
  const request = {
    intent: "clone-plan",
    planId: source.id,
    revision: String(source.revision),
    name: values.name,
    teams: JSON.stringify(teams.teams.filter(hasPlanTeamRight)),
    ...(fields
      ? {
          workspaceId: fields.workspaceId,
          target: fields.executionTarget
            ? JSON.stringify(fields.executionTarget)
            : "",
        }
      : {}),
    ...(ownerId !== page.userId ? { ownerId } : {}),
    ...(isOneShot ? { oneShot: "true" } : {}),
  };
  const key = useRequestKey(JSON.stringify(request));
  return { values, setValues, teams, ownerId, setOwnerId, request, key };
}

function PlanCloneDialog({
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

function PlanDeleteDialog({
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
      <p className="text-xs text-foreground" data-plan-delete-preview>
        {t("plans.access.deletePreview", {
          name: plan.name,
          revision: plan.revision,
          runs: t(
            page.control &&
              page.control.status !== "idle" &&
              isActivePlanRun(page.control.status)
              ? "plans.access.deleteRunActive"
              : "plans.access.deleteNoRun",
          ),
        })}
      </p>
      {plan.rights?.isAdminAccess ? (
        <p className="text-xs text-warning" data-plan-delete-admin>
          {t("plans.access.deleteAdmin")}
        </p>
      ) : null}
    </PlanDialogFrame>
  );
}
