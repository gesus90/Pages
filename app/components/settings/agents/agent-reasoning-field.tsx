import { useTranslation } from "react-i18next";

import { AssignmentSelect } from "./agent-model-field/assignment-select";

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
    <div className="space-y-2">
      <AssignmentSelect
        field="reasoning"
        value={selection.effort}
        options={selection.effortOptions}
        onValueChange={selection.chooseEffort}
        disabled={isPending || !hasLevels}
      />
      {model && !hasLevels ? (
        <p className="text-sm text-muted-foreground">
          {t("settings.agents.assignments.noEffort")}
        </p>
      ) : null}
    </div>
  );
}
