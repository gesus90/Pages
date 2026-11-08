import { useState } from "react";
import { useTranslation } from "react-i18next";

import { reasoningOptions } from "@/app/lib/reasoning-options";
import { catalogModelChoice } from "@/definition/AgentModelChoice";
import { hasFailedCatalog } from "@/definition/AgentModelCatalog";
import { resolveClaudeModelAlias } from "@/definition/AgentModelVersion";
import { agentModelKey } from "@/definition/AgentPlanConfiguration";
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
import type { ReasoningSelectOptions } from "@/app/lib/reasoning-options";
import type { PageAgentModel } from "@/definition/PageAgent";

/** Input choices come from the selected connection, never from a provider-wide union. */
export interface AssignmentChoices {
  readonly connectionId: string;
  /** The provider of the chosen connection; it decides which run options apply. */
  readonly provider: AgentProviderId | null;
  readonly modelId: string;
  /** The catalog of the chosen connection. */
  readonly models: readonly AgentCatalogModel[];
  /** The models of every connection's catalog as entries of the shared model choice. */
  readonly choices: readonly PageAgentModel[];
  /** The selection key of connection and model; empty while none is chosen. */
  readonly modelKey: string;
  /** Whether the last refresh of a catalog failed; the model choice then warns. */
  readonly isCatalogFailed: boolean;
  readonly effort: string;
  /** The family alias the saved model was stored under and this choice resolved to a version. */
  readonly savedAlias: string | null;
  readonly error:
    | "connectionUnavailable"
    | "accessUnverified"
    | "modelUnavailable"
    | "reasoningUnsupported"
    | null;
  readonly effortOptions: ReasoningSelectOptions;
  /** Why a listed model cannot be chosen, such as one of an inactive connection. */
  readonly refusalOf: (model: PageAgentModel) => string | null;
  /** Chooses connection and model together by the selection key of a listed model. */
  readonly chooseModel: (key: string) => void;
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

function selectionKey(connectionId: string, modelId: string): string {
  return connectionId && modelId ? agentModelKey(connectionId, modelId) : "";
}

// Every connection with a catalog offers its models in the one model choice.
// An API connection without a stored key is left out (PAGE-248), unless the
// saved assignment uses it: a saved assignment stays visible under its provider.
function assignmentChoices(
  connections: readonly AgentConnectionSummary[],
  catalogs: Readonly<Record<string, AgentModelCatalog>>,
  assignment: AgentModelSelection | null,
): PageAgentModel[] {
  const savedConnectionId = assignment?.connectionId;
  return connections
    .filter(
      (connection) =>
        connection.accessKind !== "api_key" ||
        connection.hasApiKey ||
        connection.id === savedConnectionId,
    )
    .flatMap((connection) =>
      (catalogs[connection.id]?.models ?? []).map((model) =>
        catalogModelChoice(connection, model),
      ),
    );
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
  const choices = assignmentChoices(
    input.connections,
    input.catalogs,
    input.assignment,
  );
  return {
    connectionId,
    provider: connection?.provider ?? null,
    modelId,
    models,
    choices,
    modelKey: selectionKey(connectionId, modelId),
    isCatalogFailed: hasFailedCatalog(input.catalogs),
    effort,
    savedAlias,
    error,
    refusalOf: (choice) => {
      const refusal = connectionRefusal(
        input.connections.find((entry) => entry.id === choice.connectionId),
      );
      return refusal === null
        ? null
        : t(`settings.agents.modelSelection.refusal.${refusal}`);
    },
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
    chooseModel: (key) => {
      const choice = choices.find((entry) => entry.id === key);
      if (!choice?.connectionId) return;
      setConnectionId(choice.connectionId);
      setModelId(choice.model);
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

// A connection that is off or whose access is not verified offers its
// models only as disabled rows; saving checks the same on the server.
function connectionRefusal(
  connection: AgentConnectionSummary | undefined,
): "connectionUnavailable" | "accessUnverified" | null {
  if (!connection?.isActive) return "connectionUnavailable";
  return hasVerifiedAccess(connection) ? null : "accessUnverified";
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
