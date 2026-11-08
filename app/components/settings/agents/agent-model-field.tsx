import { useTranslation } from "react-i18next";

import { ModelPicker } from "@/app/components/agents/model-picker";

import type { AssignmentChoices } from "./use-agent-assignment";

/**
 * Chooses the model of an agent profile in the shared model choice of Pages.
 *
 * @remarks
 * Connection and model are one choice: every connection's catalog lists its
 * models under their tool, and choosing one keeps the model's own
 * connection. Models of a connection that is off or not verified stay listed
 * as disabled rows with the reason. A saved value outside the catalogs stays
 * visible as unavailable and is never replaced on its own.
 */
export function AgentModelField({
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
      isCatalogFailed={selection.isCatalogFailed}
      onChange={selection.chooseModel}
    />
  );
}

/** Names the family alias a saved model was stored under and the version it resolved to. */
export function AgentModelAliasNotice({
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
