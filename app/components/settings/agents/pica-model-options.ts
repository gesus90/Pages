import { createElement } from "react";

import {
  AGENT_CONNECTION_LOCATIONS,
  AGENT_PROVIDERS,
  isApiProvider,
  linkedApiProviderOf,
  OPENCODE_FREE_PROVIDER,
  openCodeModelProvider,
} from "@/definition/AgentConnection";

import { ProviderIcon } from "./provider-icon";
import { isPicaModel } from "@/definition/PicaModelSelection";

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

// A Claude CLI row is named after its version; the concrete model ID it stands for comes first, so a narrow list wraps between ID and access.
function detailLabel(model: PageAgentModel, translate: TFunction): string {
  const access = accessLabel(model, translate);
  return model.provider === "claude_code"
    ? `${model.model} · ${access}`
    : access;
}

/** The tag of free models, shared with the prefilter of the model choice. */
export const FREE_MODEL_TAG = "free";

/**
 * The provider OpenCode runs a model with, named like its API connection.
 *
 * @param model - A model of an OpenCode connection, local or remote.
 * @param translate - Translates the provider names.
 * @returns For example "Google AI Studio (Gemini)", or "OpenCode Zen" for
 * OpenCode's own provider.
 */
export function openCodeProviderLabel(
  model: PageAgentModel,
  translate: TFunction,
): string {
  const modelProvider = openCodeModelProvider(model.model);
  const provider = linkedApiProviderOf(modelProvider);
  if (provider !== null)
    return translate(`settings.agents.provider.${provider}`);
  return modelProvider === OPENCODE_FREE_PROVIDER
    ? translate("settings.agents.openCodeZen")
    : modelProvider;
}

// OpenCode lists its free models as a group of their own, every other model under its provider.
function openCodeGroup(model: PageAgentModel, translate: TFunction): string {
  return openCodeModelProvider(model.model) === OPENCODE_FREE_PROVIDER &&
    model.isFree === true
    ? translate("settings.agents.openCodeFreeGroup")
    : `opencode · ${openCodeProviderLabel(model, translate)}`;
}

function openCodeOption(
  model: PageAgentModel,
  translate: TFunction,
): Pick<SearchableSelectOption, "group" | "description" | "icon"> {
  const provider = `opencode · ${openCodeProviderLabel(model, translate)}`;
  return {
    group: openCodeGroup(model, translate),
    description:
      model.isFree === true
        ? `${provider} · ${translate("settings.agents.freeBadge")}`
        : provider,
    icon: createElement(ProviderIcon, {
      provider: openCodeModelProvider(model.model),
    }),
  };
}

function vendorOption(
  model: PageAgentModel,
  translate: TFunction,
): Pick<SearchableSelectOption, "group" | "description" | "icon"> {
  const { vendor } = AGENT_PROVIDERS[model.provider];
  return {
    group: translate(`settings.agents.provider.${vendor}`),
    description: detailLabel(model, translate),
    icon: createElement(ProviderIcon, { provider: vendor }),
  };
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
      ...(model.provider === "opencode"
        ? openCodeOption(model, translate)
        : vendorOption(model, translate)),
      keywords: [
        model.model,
        model.connectionName ?? "",
        translate(`settings.agents.provider.${model.provider}`),
        translate(`settings.agents.providerShort.${model.provider}`),
      ],
      ...(model.isFree === true ? { tags: [FREE_MODEL_TAG] } : {}),
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
      .filter(isPicaModel)
      .map((model) => listedModel(model, translate))
      .toSorted(compareListed),
  );
}
