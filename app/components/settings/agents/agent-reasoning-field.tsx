import { useTranslation } from "react-i18next";

import { ReasoningField } from "@/app/components/agents/model-picker/model-field";

import type { AssignmentChoices } from "./use-agent-assignment";

/** Offers only the chosen model's levels and explains catalogs without selectable levels. */
export function AgentReasoningField({
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
