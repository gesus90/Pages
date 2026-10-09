import { useState } from "react";
import { useTranslation } from "react-i18next";

import { AGENT_PROVIDERS } from "@/definition/AgentConnection";

import type { AgentAssignment } from "@/definition/AgentAssignment";
import type { AgentConnectionSummary } from "@/definition/AgentConnection";
import type {
  AgentCatalogModel,
  AgentModelCatalog,
} from "@/definition/AgentModelCatalog";
import type { Select } from "@/app/components/ui/select";
import type { SearchableSelectOption } from "@/app/components/ui/searchable-select/use-searchable-select";

/** Input choices come from the selected connection, never from a provider-wide union. */
export interface AssignmentChoices {
  readonly connectionId: string;
  readonly modelId: string;
  readonly models: readonly AgentCatalogModel[];
  readonly effort: string;
  readonly error:
    | "connectionUnavailable"
    | "accessUnverified"
    | "modelUnavailable"
    | "reasoningUnsupported"
    | null;
  /** Every connection as "Name (Provider)", also found by the provider's full name. */
  readonly connectionOptions: readonly SearchableSelectOption[];
  readonly effortOptions: React.ComponentProps<typeof Select>["options"];
  readonly chooseConnection: (id: string) => void;
  readonly chooseModel: (id: string) => void;
  readonly chooseEffort: (effort: string) => void;
}

function keepUnavailable(
  options: React.ComponentProps<typeof Select>["options"],
  selected: string,
  label: string,
): React.ComponentProps<typeof Select>["options"] {
  if (!selected || options.some((option) => option.value === selected))
    return options;
  return [
    ...options,
    { value: selected, label: `${selected} (${label})`, disabled: true },
  ];
}

/** Preserves invalid saved values and clears dependent choices only on an explicit change. */
export function useAgentAssignment(input: {
  readonly assignment: AgentAssignment | null;
  readonly connections: readonly AgentConnectionSummary[];
  readonly catalogs: Readonly<Record<string, AgentModelCatalog>>;
}): AssignmentChoices {
  const { t } = useTranslation();
  const [connectionId, setConnectionId] = useState(
    input.assignment?.connectionId ?? "",
  );
  const [modelId, setModelId] = useState(input.assignment?.model ?? "");
  const [effort, setEffort] = useState(input.assignment?.reasoningEffort ?? "");
  const models = input.catalogs[connectionId]?.models ?? [];
  const model = models.find((entry) => entry.id === modelId);
  const connection = input.connections.find(
    (entry) => entry.id === connectionId,
  );
  const error = choiceError({
    connection,
    hasAccess: hasVerifiedAccess(connection),
    modelExists: Boolean(model),
    hasEffort: hasSupportedEffort(model, effort),
  });
  return {
    connectionId,
    modelId,
    models,
    effort,
    error,
    connectionOptions: input.connections.map((entry) => ({
      value: entry.id,
      label: `${entry.name} (${t(`settings.agents.providerShort.${entry.provider}`)})`,
      keywords: [t(AGENT_PROVIDERS[entry.provider].labelKey)],
    })),
    effortOptions: keepUnavailable(
      [
        {
          value: "",
          label: t(
            model?.reasoningEfforts.length
              ? "settings.agents.assignments.chooseEffort"
              : "settings.agents.assignments.noEffort",
          ),
        },
        ...(model?.reasoningEfforts ?? []).map((entry) => ({
          value: entry,
          label: entry,
        })),
      ],
      effort,
      t("assistant.settings.unavailable"),
    ),
    chooseConnection: (id) => {
      setConnectionId(id);
      setModelId("");
      setEffort("");
    },
    chooseModel: (id) => {
      setModelId(id);
      setEffort("");
    },
    chooseEffort: setEffort,
  };
}

function hasVerifiedAccess(
  connection: AgentConnectionSummary | undefined,
): boolean {
  if (connection?.accessKind !== "api_key")
    return Boolean(connection?.cli?.loggedInAt);
  return connection.hasApiKey && connection.checks.auth?.status === "passed";
}

function hasSupportedEffort(
  model: AgentCatalogModel | undefined,
  effort: string,
): boolean {
  if (effort === "") return (model?.reasoningEfforts.length ?? 0) === 0;
  return Boolean(model?.reasoningEfforts.includes(effort));
}

function choiceError(input: {
  readonly connection: AgentConnectionSummary | undefined;
  readonly hasAccess: boolean;
  readonly modelExists: boolean;
  readonly hasEffort: boolean;
}): AssignmentChoices["error"] {
  if (!input.connection) return "connectionUnavailable";
  if (!input.hasAccess) return "accessUnverified";
  if (!input.modelExists) return "modelUnavailable";
  if (!input.hasEffort) return "reasoningUnsupported";
  return null;
}
