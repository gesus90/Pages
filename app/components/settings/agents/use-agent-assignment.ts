import { useState } from "react";
import { useTranslation } from "react-i18next";

import { reasoningOptions } from "@/app/lib/reasoning-options";
import { AGENT_PROVIDERS } from "@/definition/AgentConnection";
import { resolveClaudeModelAlias } from "@/definition/AgentModelVersion";
import { hasLevelPicker } from "@/definition/AgentReasoningChoice";

import type { AgentModelSelection } from "@/definition/AgentModelSelection";
import type {
  AgentConnectionSummary,
  AgentProviderId,
} from "@/definition/AgentConnection";
import type {
  AgentCatalogModel,
  AgentModelCatalog,
} from "@/definition/AgentModelCatalog";
import type { SearchableSelectOption } from "@/app/components/ui/searchable-select/use-searchable-select";
import type { ReasoningSelectOptions } from "@/app/lib/reasoning-options";

/** Input choices come from the selected connection, never from a provider-wide union. */
export interface AssignmentChoices {
  readonly connectionId: string;
  /** The provider of the chosen connection; it decides which run options apply. */
  readonly provider: AgentProviderId | null;
  readonly modelId: string;
  readonly models: readonly AgentCatalogModel[];
  readonly effort: string;
  /** The family alias the saved model was stored under and this choice resolved to a version. */
  readonly savedAlias: string | null;
  readonly error:
    | "connectionUnavailable"
    | "accessUnverified"
    | "modelUnavailable"
    | "reasoningUnsupported"
    | null;
  /** Every connection as "Name (Provider)", also found by the provider's full name. */
  readonly connectionOptions: readonly SearchableSelectOption[];
  readonly effortOptions: ReasoningSelectOptions;
  readonly chooseConnection: (id: string) => void;
  readonly chooseModel: (id: string) => void;
  readonly chooseEffort: (effort: string) => void;
}

/**
 * The model value a saved assignment starts on.
 *
 * @remarks
 * A Claude family alias an earlier version stored, such as `sonnet`, starts
 * on the version the connection's catalog lists for it; saving then stores
 * that concrete ID. A value that resolves to nothing stays as it is.
 */
function startingModel(
  assignment: AgentModelSelection | null,
  connections: readonly AgentConnectionSummary[],
  catalogs: Readonly<Record<string, AgentModelCatalog>>,
): { readonly modelId: string; readonly alias: string | null } {
  const stored = assignment?.model ?? "";
  const listed = catalogs[assignment?.connectionId ?? ""]?.models ?? [];
  const provider = connections.find(
    (entry) => entry.id === assignment?.connectionId,
  )?.provider;
  if (provider !== "claude_code" || listed.some((entry) => entry.id === stored))
    return { modelId: stored, alias: null };
  const resolved = resolveClaudeModelAlias(
    stored,
    listed.map((entry) => ({ id: entry.id, aliases: entry.aliases })),
  );
  return resolved === null
    ? { modelId: stored, alias: null }
    : { modelId: resolved, alias: stored };
}

/** Preserves invalid saved values and clears dependent choices only on an explicit change. */
export function useAgentAssignment(input: {
  readonly assignment: AgentModelSelection | null;
  readonly connections: readonly AgentConnectionSummary[];
  readonly catalogs: Readonly<Record<string, AgentModelCatalog>>;
}): AssignmentChoices {
  const { t } = useTranslation();
  const [connectionId, setConnectionId] = useState(
    input.assignment?.connectionId ?? "",
  );
  const starting = startingModel(
    input.assignment,
    input.connections,
    input.catalogs,
  );
  const [modelId, setModelId] = useState(starting.modelId);
  const [savedAlias, setSavedAlias] = useState(starting.alias);
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
    provider: connection?.provider ?? null,
    modelId,
    models,
    effort,
    savedAlias,
    error,
    connectionOptions: input.connections.map((entry) => ({
      value: entry.id,
      label: `${entry.name} (${t(`settings.agents.providerShort.${entry.provider}`)})`,
      keywords: [t(AGENT_PROVIDERS[entry.provider].labelKey)],
    })),
    effortOptions: reasoningOptions({
      model,
      modelName: model?.name ?? modelId,
      siblings: hasLevelPicker(connection?.provider) ? models : [],
      current: effort,
      defaultLabel: t(
        model?.reasoningEfforts.length
          ? "settings.agents.assignments.chooseEffort"
          : "settings.agents.assignments.noEffort",
      ),
      translate: t,
    }),
    chooseConnection: (id) => {
      setConnectionId(id);
      setModelId("");
      setSavedAlias(null);
      setEffort("");
    },
    chooseModel: (id) => {
      setModelId(id);
      setSavedAlias(null);
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
  if (!input.connection || !input.connection.isActive)
    return "connectionUnavailable";
  if (!input.hasAccess) return "accessUnverified";
  if (!input.modelExists) return "modelUnavailable";
  if (!input.hasEffort) return "reasoningUnsupported";
  return null;
}
