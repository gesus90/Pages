import { useTranslation } from "react-i18next";

import { ModelPicker } from "@/app/components/agents/model-picker";
import {
  ModelFieldRow,
  ReasoningField,
} from "@/app/components/agents/model-picker/model-field";
import { Input } from "@/app/components/ui/input";
import { AGENT_PROFILE_PURPOSES } from "@/definition/AgentProfile";

import type { AgentProfilePurpose } from "@/definition/AgentProfile";
import type { AssignmentChoices } from "./use-agent-assignment";

// Connection and model are one choice: every connection's catalog lists its
// models under their tool, and choosing one keeps the model's own connection.
function AgentModelField({
  selection,
  isPending,
}: {
  readonly selection: AssignmentChoices;
  readonly isPending: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <ModelPicker
      value={selection.modelKey}
      models={selection.choices}
      savedModel={selection.modelId || undefined}
      disabled={isPending}
      label={t("settings.agents.modelSelection.model")}
      placeholder={t("settings.agents.modelSelection.chooseModel")}
      refusalOf={selection.refusalOf}
      onChange={selection.chooseModel}
    />
  );
}

function AgentModelAliasNotice({
  selection,
}: {
  readonly selection: AssignmentChoices;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (!selection.savedAlias) return null;
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {t("settings.agents.modelSelection.aliasResolved", {
        alias: selection.savedAlias,
        model: selection.models.find((entry) => entry.id === selection.modelId)
          ?.name,
        id: selection.modelId,
      })}
    </p>
  );
}

function AgentReasoningField({
  selection,
  isPending,
}: {
  readonly selection: AssignmentChoices;
  readonly isPending: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const model = selection.models.find(
    (entry) => entry.id === selection.modelId,
  );
  const hasLevels = Boolean(model?.reasoningEfforts.length);
  return (
    <ReasoningField
      value={selection.effort}
      options={selection.effortOptions}
      disabled={isPending}
      note={
        model && !hasLevels ? t("settings.agents.assignments.noEffort") : null
      }
      onChange={selection.chooseEffort}
    />
  );
}

/** Edits a profile with the shared model choice, without invoking any provider. */
export function AgentProfileFields(props: {
  readonly name: string;
  readonly isActive: boolean;
  readonly purposes: readonly AgentProfilePurpose[];
  readonly selection: AssignmentChoices;
  readonly isPending: boolean;
  readonly onName: (name: string) => void;
  readonly onActive: (isActive: boolean) => void;
  readonly onPurposes: (purposes: readonly AgentProfilePurpose[]) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  function toggle(purpose: AgentProfilePurpose, checked: boolean): void {
    props.onPurposes(
      checked
        ? [...props.purposes, purpose]
        : props.purposes.filter((entry) => entry !== purpose),
    );
  }
  return (
    <>
      <label htmlFor="agent-profile-name" className="block text-sm font-medium">
        {t("settings.agents.name")}
      </label>
      <Input
        id="agent-profile-name"
        value={props.name}
        maxLength={80}
        required
        disabled={props.isPending}
        onChange={(event) => props.onName(event.target.value)}
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={props.isActive}
          disabled={props.isPending}
          onChange={(event) => props.onActive(event.target.checked)}
        />
        {t("settings.agents.profiles.active")}
      </label>
      <ModelFieldRow>
        <AgentModelField
          selection={props.selection}
          isPending={props.isPending}
        />
        <AgentReasoningField
          selection={props.selection}
          isPending={props.isPending}
        />
      </ModelFieldRow>
      <AgentModelAliasNotice selection={props.selection} />
      <fieldset disabled={props.isPending} className="space-y-2">
        <legend className="text-sm font-medium">
          {t("settings.agents.profiles.purposes")}
        </legend>
        {AGENT_PROFILE_PURPOSES.map((purpose) => (
          <label key={purpose} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={props.purposes.includes(purpose)}
              onChange={(event) => toggle(purpose, event.target.checked)}
            />
            {t(`settings.agents.profiles.purpose.${purpose}`)}
          </label>
        ))}
      </fieldset>
    </>
  );
}
