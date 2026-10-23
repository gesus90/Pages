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

/** Offers the exact CLI picker of an authenticated remote tool, with a content-bound revision. */
export function remoteCliModels(
  target: AgentPlanRemoteTarget,
  tools: readonly ToolInventory[],
): readonly PageAgentModel[] {
  return tools.flatMap((tool): PageAgentModel[] => {
    if (
      tool.authentication !== "authenticated" ||
      !tool.catalogRevision ||
      tool.tool === "opencode"
    )
      return [];
    const provider = tool.tool === "codex" ? "codex_cli" : "claude_code";
    return (tool.models ?? []).map((model) => ({
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
      name: `${target.connectionName} / ${target.workspaceName} / ${tool.tool} / ${model.name}`,
      modelName: model.name,
      connectionName: `${target.connectionName} / ${tool.tool}`,
      provider,
      reasoning: model.reasoningEfforts.length ? "levels" : "unknown",
      reasoningEfforts: model.reasoningEfforts,
      catalogDefaultReasoningEffort: null,
      reasoningEffort: null,
    }));
  });
}
