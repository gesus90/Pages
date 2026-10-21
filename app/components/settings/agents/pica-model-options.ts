import {
  AGENT_CONNECTION_LOCATIONS,
  AGENT_PROVIDERS,
  isApiProvider,
} from "@/definition/AgentConnection";

import type { SearchableSelectOption } from "@/app/components/ui/searchable-select/use-searchable-select";
import type { AgentConnectionLocation } from "@/definition/AgentConnection";
import type { PageAgentModel } from "@/definition/PageAgent";
import type { TFunction } from "i18next";

const NAME_ORDER = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

interface ListedModel {
  readonly locationRank: number;
  readonly connectionName: string;
  readonly option: SearchableSelectOption;
}

// Models without a location, from legacy projections, follow every location.
function locationRank(location: AgentConnectionLocation | undefined): number {
  return location === undefined
    ? AGENT_CONNECTION_LOCATIONS.length
    : AGENT_CONNECTION_LOCATIONS.indexOf(location);
}

// An API keeps its short name, such as "OpenAI API", because its full name is
// the vendor heading above it; a CLI names its account or subscription.
function accessLabel(model: PageAgentModel, translate: TFunction): string {
  const access = translate(
    isApiProvider(model.provider)
      ? `settings.agents.providerShort.${model.provider}`
      : `settings.agents.provider.${model.provider}`,
  );
  return model.isManual
    ? `${access} · ${translate("picaSettings.manual")}`
    : access;
}

function listedModel(model: PageAgentModel, translate: TFunction): ListedModel {
  return {
    locationRank: locationRank(model.location),
    connectionName: model.connectionName ?? "",
    option: {
      value: model.id,
      label: model.modelName ?? model.name,
      section:
        model.location === undefined
          ? undefined
          : translate(`settings.agents.location.${model.location}`),
      group: translate(
        `settings.agents.provider.${AGENT_PROVIDERS[model.provider].vendor}`,
      ),
      description: accessLabel(model, translate),
      keywords: [
        model.model,
        model.connectionName ?? "",
        translate(`settings.agents.provider.${model.provider}`),
        translate(`settings.agents.providerShort.${model.provider}`),
      ],
    },
  };
}

function compareListed(first: ListedModel, second: ListedModel): number {
  return (
    first.locationRank - second.locationRank ||
    NAME_ORDER.compare(first.option.group ?? "", second.option.group ?? "") ||
    NAME_ORDER.compare(first.option.label, second.option.label) ||
    NAME_ORDER.compare(
      first.option.description ?? "",
      second.option.description ?? "",
    ) ||
    NAME_ORDER.compare(first.connectionName, second.connectionName)
  );
}

function appearance(option: SearchableSelectOption): string {
  return [option.section, option.group, option.label, option.description].join(
    "\n",
  );
}

// Two options alike in heading, name and access, such as one model of two
// Codex accounts, add their connection name so each stays recognisable.
function distinguishAlike(
  models: readonly ListedModel[],
): SearchableSelectOption[] {
  const counts = new Map<string, number>();
  for (const { option } of models)
    counts.set(appearance(option), (counts.get(appearance(option)) ?? 0) + 1);
  return models.map(({ option, connectionName }) =>
    (counts.get(appearance(option)) ?? 0) > 1 && connectionName !== ""
      ? { ...option, description: `${option.description} · ${connectionName}` }
      : option,
  );
}

/**
 * Lists the models Pica may use under their location and provider.
 *
 * @remarks
 * Locations follow their fixed order, providers and models their names, so
 * models of one name reached through several connections stand side by side
 * under one provider and differ by their way of access.
 *
 * @param models - The models released for the administrator.
 * @param translate - Translates the location, provider and access names.
 * @returns One option per model, ordered for the grouped model choice.
 */
export function picaModelOptions(
  models: readonly PageAgentModel[],
  translate: TFunction,
): SearchableSelectOption[] {
  return distinguishAlike(
    models
      .map((model) => listedModel(model, translate))
      .toSorted(compareListed),
  );
}
