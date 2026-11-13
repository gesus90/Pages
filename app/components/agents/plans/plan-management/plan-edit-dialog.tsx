import { LockKeyhole } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { isPlanAdministrator } from "@/definition/AgentPlanTeam";

import { planNodeLabel } from "../plan-layout";
import { planRequestError } from "./plan-context-model";
import { PlanDialogFrame } from "./plan-dialog-frame";
import {
  PlanOneShotConfirmDialog,
  PlanOneShotField,
} from "./plan-one-shot-field";
import { PlanSettingsTeams, PlanOwnerField } from "./plan-access-teams";
import {
  PlanSettingsName,
  PlanSettingsOptions,
  PlanSettingsContext,
} from "./plan-settings-fields";
import { PlanDeviationChoice } from "./plan-deviation-choice";
import { usePlanEditSettings } from "./use-plan-edit-settings";

import type { PlanEditDialogProps } from "./use-plan-edit-settings";

/** Edits the saved context and team list; readers get an explained path to their own copy. */
export function PlanEditDialog({
  page,
  plan,
  editor,
  management,
}: PlanEditDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const searchId = useId();
  const settings = usePlanEditSettings({ page, plan, editor, management });
  const {
    values,
    setValues,
    teams,
    oneShot,
    save,
    isReadOnly,
    isLocked,
    isIncomplete,
    submit,
  } = settings;
  return (
    <>
      <PlanDialogFrame
        title={t("plans.manage.editTitle")}
        description={t("plans.manage.editSource", {
          name: plan.name,
          revision: plan.revision,
        })}
        submitLabel={t(
          isReadOnly ? "plans.manage.clone" : "plans.execution.save",
        )}
        cancelLabel={isReadOnly ? t("plans.manage.close") : undefined}
        isPending={save.isSubmitted && editor.isPending}
        isSubmitDisabled={!isReadOnly && Boolean(isIncomplete)}
        error={planRequestError(save.error, t)}
        onSubmit={submit}
        onClose={management.close}
      >
        {isReadOnly ? <PlanReadOnlyNotice page={page} plan={plan} /> : null}
        <PlanSettingsName
          name={values.name}
          isReadOnly={isLocked}
          onChange={(name) => setValues({ ...values, name })}
        />
        <PlanSettingsOptions page={page} values={values} teams={teams.teams}>
          <PlanEditOptions
            page={page}
            plan={plan}
            editor={editor}
            settings={settings}
            searchId={searchId}
          />
        </PlanSettingsOptions>
        {editor.isDirty ? (
          <p role="note" className="text-xs text-muted-foreground">
            {t("plans.manage.editUnsaved")}
          </p>
        ) : null}
      </PlanDialogFrame>
      <PlanOneShotConfirmDialog choice={oneShot} />
    </>
  );
}

function PlanEditOptions({
  page,
  plan,
  editor,
  settings,
  searchId,
}: Omit<PlanEditDialogProps, "management"> & {
  readonly settings: ReturnType<typeof usePlanEditSettings>;
  readonly searchId: string;
}): React.ReactElement {
  const { values, setValues, teams, oneShot, isLocked } = settings;
  return (
    <>
      <PlanSettingsTeams
        directory={page.directory}
        state={teams}
        isDisabled={isLocked}
        canManage={plan.rights?.canManageTeams === true}
        searchId={searchId}
      />
      <PlanSettingsContext
        page={page}
        values={values}
        onChange={setValues}
        isDisabled={isLocked}
        isProjectFixed={
          plan.ownerId !== page.userId && !isPlanAdministrator(plan)
        }
        hasProject
      />
      <PlanOneShotField choice={oneShot} isDisabled={isLocked} />
      {plan.rights?.canChangeOwner ? (
        <PlanOwnerField
          page={page}
          ownerId={settings.ownerId}
          isDisabled={isLocked}
          onChange={settings.setOwnerId}
        />
      ) : null}
      {settings.deviations.length > 0 ? (
        <PlanDeviationChoice
          names={settings.deviations.map((node) =>
            planNodeLabel(node, editor.sources),
          )}
          choice={settings.choice}
          onChoose={settings.setChoice}
        />
      ) : null}
    </>
  );
}

function PlanReadOnlyNotice({
  page,
  plan,
}: Pick<PlanEditDialogProps, "page" | "plan">): React.ReactElement {
  const { t } = useTranslation();
  const ownerName =
    page.directory.persons.find((entry) => entry.id === plan.ownerId)?.name ??
    plan.ownerId;
  return (
    <div className="flex gap-2 rounded-xl bg-muted p-3 text-sm">
      <LockKeyhole aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <p>
        <strong>{t("plans.manage.readOnlyTitle")}</strong>{" "}
        {t("plans.manage.readOnlyBody", { name: ownerName })}
      </p>
    </div>
  );
}
