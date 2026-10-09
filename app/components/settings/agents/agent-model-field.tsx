import { useTranslation } from "react-i18next";

import { SearchableSelect } from "@/app/components/ui/searchable-select";

import type { SearchableSelectOption } from "@/app/components/ui/searchable-select/use-searchable-select";
import type { AgentCatalogModel } from "@/definition/AgentModelCatalog";
import type { AssignmentChoices } from "./use-agent-assignment";

// Tags of the model panel's prefilters.
const LEVELS_TAG = "levels";
const FREE_TAG = "free";

function modelOption(
  model: AgentCatalogModel,
  freeLabel: string,
): SearchableSelectOption {
  return {
    value: model.id,
    label: `${model.name} (${model.id})${model.isFree ? ` · ${freeLabel}` : ""}`,
    tags: [
      ...(model.reasoningEfforts.length > 0 ? [LEVELS_TAG] : []),
      ...(model.isFree ? [FREE_TAG] : []),
    ],
  };
}

/**
 * Chooses a named connection and a model of exactly that connection's catalog.
 *
 * @remarks
 * Both dropdowns search inside their open panel. The model panel adds
 * prefilters for listed reasoning levels and, when the catalog states
 * prices, for free models. Searching and filtering never change the
 * assignment; a saved value outside the catalog stays visible as unavailable.
 */
export function AgentModelField({
  selection,
  isPending,
}: {
  readonly selection: AssignmentChoices;
  readonly isPending: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const freeLabel = t("settings.agents.catalog.free");
  const hasPrices = selection.models.some(
    (model) => model.promptPrice !== null && model.completionPrice !== null,
  );
  const unavailable = t("assistant.settings.unavailable");
  return (
    <section className="min-w-0 space-y-3">
      <SearchableSelect
        id="assignment-connection"
        label={t("assistant.settings.connection")}
        value={selection.connectionId}
        options={selection.connectionOptions}
        onValueChange={selection.chooseConnection}
        disabled={isPending}
        texts={{
          placeholder: t("settings.agents.assignments.chooseConnection"),
          unavailable,
          search: t("settings.agents.assignments.searchConnections"),
          empty: t("settings.agents.assignments.noConnections"),
          count: (count, total) =>
            t("settings.agents.assignments.connectionCount", { count, total }),
        }}
      />
      <SearchableSelect
        id="assignment-model"
        label={t("assistant.settings.model")}
        value={selection.modelId}
        options={selection.models.map((model) => modelOption(model, freeLabel))}
        onValueChange={selection.chooseModel}
        disabled={isPending || !selection.connectionId}
        filters={[
          {
            tag: LEVELS_TAG,
            label: t("settings.agents.assignments.filters.withLevels"),
          },
          ...(hasPrices ? [{ tag: FREE_TAG, label: freeLabel }] : []),
        ]}
        texts={{
          placeholder: t("assistant.settings.chooseModel"),
          unavailable,
          search: t("settings.agents.catalog.search"),
          empty: t("settings.agents.assignments.filters.empty"),
          count: (count, total) =>
            t("settings.agents.catalog.count", { count, total }),
        }}
      />
    </section>
  );
}
