import { isAgentModel } from "@/definition/AgentModelFilter";
import { describeClaudeModel } from "@/definition/AgentModelVersion";
import { MODEL_MODALITIES } from "@/definition/RemoteSetup";

import type { PageAgentModel } from "@/definition/PageAgent";
import type { AgentPlanRemoteTarget } from "@/definition/AgentPlanExecution";
import type { ToolInventory } from "@/definition/RemoteSetup";
import type { RunnerOpenRouterResult } from "@/definition/RunnerOpenRouter";

/** Projects only the free catalog explicitly synchronized on this runner. */
export function remoteOpenRouterModels(
  target: AgentPlanRemoteTarget,
  catalog: Extract<RunnerOpenRouterResult, { operation: "catalog" }>,
): readonly PageAgentModel[] {
  return catalog.freeModels.map((model) => ({
    id: JSON.stringify([target.workspaceId, catalog.syncedAt, model.id]),
    runnerRoute: {
      connectionId: target.connectionId,
      workspaceId: target.workspaceId,
      catalogRevision: catalog.syncedAt,
    },
    model: model.id,
    name: `${target.connectionName} / ${target.workspaceName} / ${model.name}`,
    modelName: model.name,
    connectionName: `${target.connectionName} / OpenRouter`,
    provider: "openrouter",
    contextWindow: model.contextLength ?? null,
    maxOutputTokens: model.maxOutputTokens ?? null,
    reasoning: "unknown",
    reasoningEfforts: [],
    catalogDefaultReasoningEffort: null,
    reasoningEffort: null,
  }));
}

type RemoteModel = NonNullable<ToolInventory["models"]>[number];

// The runner reports OpenCode's statements as they are; the global filter decides here, as for local catalogs.
function isListedRemoteModel(model: RemoteModel): boolean {
  return isAgentModel({
    status: model.status,
    output:
      model.outputs === undefined
        ? undefined
        : Object.fromEntries(
            MODEL_MODALITIES.map((modality) => [
              modality,
              model.outputs?.includes(modality) === true,
            ]),
          ),
    toolCall: model.toolCall,
  });
}

/**
 * Offers the models OpenCode can use on the remote host with the providers set up there.
 *
 * @remarks
 * Pages sends no key to the host, so the list may hold models the local
 * instance has no key for. An ACP contract the runner found incompatible
 * offers nothing.
 */
function remoteOpenCodeModels(
  target: AgentPlanRemoteTarget,
  tool: ToolInventory,
): PageAgentModel[] {
  if (tool.acp === undefined || tool.acp.status === "incompatible") return [];
  return (tool.models ?? []).filter(isListedRemoteModel).map((model) => ({
    id: JSON.stringify([
      target.workspaceId,
      tool.tool,
      tool.catalogRevision,
      model.id,
    ]),
    runnerRoute: {
      connectionId: target.connectionId,
      workspaceId: target.workspaceId,
      catalogRevision: tool.catalogRevision ?? "",
      tool: "opencode",
    },
    model: model.id,
    name: `${target.connectionName} / ${target.workspaceName} / opencode / ${model.name}`,
    modelName: model.name,
    connectionName: `${target.connectionName} / opencode`,
    targetName: `${target.connectionName} / ${target.workspaceName}`,
    provider: "opencode",
    reasoning: model.reasoningEfforts.length ? "levels" : "unknown",
    reasoningEfforts: model.reasoningEfforts,
    catalogDefaultReasoningEffort: null,
    reasoningEffort: null,
    ...(model.isFree === undefined ? {} : { isFree: model.isFree }),
    ...(model.toolCall === undefined ? {} : { isToolCapable: model.toolCall }),
  }));
}

/** Offers the exact CLI picker of an authenticated remote tool, with a content-bound revision. */
export function remoteCliModels(
  target: AgentPlanRemoteTarget,
  tools: readonly ToolInventory[],
  hasOpenCodeAccess = false,
): readonly PageAgentModel[] {
  return tools.flatMap((tool): PageAgentModel[] => {
    if (tool.authentication !== "authenticated" || !tool.catalogRevision)
      return [];
    if (tool.tool === "opencode")
      return hasOpenCodeAccess ? remoteOpenCodeModels(target, tool) : [];
    const provider = tool.tool === "codex" ? "codex_cli" : "claude_code";
    return (tool.models ?? []).map((model) => {
      // An older runner reports a Claude row by its family only; the ID it resolves to names the version.
      const modelName = describeClaudeModel(model.id, model.name);
      return {
        id: JSON.stringify([
          target.workspaceId,
          tool.tool,
          tool.catalogRevision,
          model.id,
        ]),
        runnerRoute: {
          connectionId: target.connectionId,
          workspaceId: target.workspaceId,
          catalogRevision: tool.catalogRevision ?? "",
          tool: tool.tool === "codex" ? "codex" : "claude",
        },
        model: model.id,
        name: `${target.connectionName} / ${target.workspaceName} / ${tool.tool} / ${modelName}`,
        modelName,
        connectionName: `${target.connectionName} / ${tool.tool}`,
        provider,
        reasoning: model.reasoningEfforts.length ? "levels" : "unknown",
        reasoningEfforts: model.reasoningEfforts,
        catalogDefaultReasoningEffort: null,
        reasoningEffort: null,
      };
    });
  });
}
