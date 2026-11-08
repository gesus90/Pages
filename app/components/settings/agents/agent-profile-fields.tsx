import { useTranslation } from "react-i18next";

import { ModelFieldRow } from "@/app/components/agents/model-picker/model-field";
import { Input } from "@/app/components/ui/input";
import { AGENT_PROFILE_PURPOSES } from "@/definition/AgentProfile";

import { AgentModelAliasNotice, AgentModelField } from "./agent-model-field";
import { AgentReasoningField } from "./agent-reasoning-field";

import type { AgentProfilePurpose } from "@/definition/AgentProfile";
import type { AssignmentChoices } from "./use-agent-assignment";

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
