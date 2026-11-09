import { agentModelKey } from "@/definition/AgentPlanConfiguration";

import type {
  AgentEmployee,
  AgentEmployeeAccess,
} from "@/definition/AgentEmployee";
import type { PageAgentModel } from "@/definition/PageAgent";

/** The editable fields of the agent panel. */
export interface AgentDraft {
  readonly displayName: string;
  readonly username: string;
  readonly position: string;
  readonly avatarColor: string | null;
  /** The selection key of the model choice. */
  readonly modelKey: string;
  readonly reasoningEffort: string;
  readonly access: AgentEmployeeAccess;
  readonly roleId: string;
  readonly departments: readonly string[];
  readonly soul: string;
  readonly instructions: string;
  readonly memory: string;
  readonly isLearningEnabled: boolean;
}

/** Changes one field of the draft. */
export type AgentDraftChange = <Key extends keyof AgentDraft>(
  key: Key,
  value: AgentDraft[Key],
) => void;

/**
 * The draft a panel starts with: the stored agent, or an empty agent with
 * the given role and the prefilled `SOUL.md`.
 */
export function createAgentDraft(
  agent: AgentEmployee | null,
  defaults: { readonly roleId: string; readonly soul: string },
): AgentDraft {
  if (!agent)
    return {
      displayName: "",
      username: "",
      position: "",
      avatarColor: null,
      modelKey: "",
      reasoningEffort: "",
      access: "read_only",
      roleId: defaults.roleId,
      departments: [],
      soul: defaults.soul,
      instructions: "",
      memory: "",
      isLearningEnabled: true,
    };
  return {
    displayName: agent.displayName,
    username: agent.username,
    position: agent.position ?? "",
    avatarColor: agent.avatarColor,
    modelKey: agentModelKey(agent.settings.connectionId, agent.settings.model),
    reasoningEffort: agent.settings.reasoningEffort ?? "",
    access: agent.settings.access,
    roleId: agent.roleId ?? defaults.roleId,
    departments: agent.departmentIds,
    soul: agent.documents.soul,
    instructions: agent.documents.instructions,
    memory: agent.memory,
    isLearningEnabled: agent.learning.isEnabled,
  };
}

/** Finds connection and model of a selection key. */
function selectionOf(
  draft: AgentDraft,
  models: readonly PageAgentModel[],
  agent: AgentEmployee | null,
): { readonly connectionId: string; readonly model: string } {
  const model = models.find((entry) => entry.id === draft.modelKey);
  if (model?.connectionId)
    return { connectionId: model.connectionId, model: model.model };
  // A saved model the list no longer offers keeps its stored values; the server decides.
  if (
    agent &&
    draft.modelKey ===
      agentModelKey(agent.settings.connectionId, agent.settings.model)
  )
    return {
      connectionId: agent.settings.connectionId,
      model: agent.settings.model,
    };
  return { connectionId: "", model: "" };
}

/** The JSON the panel sends; the server checks every field again. */
export function agentDraftPayload(
  draft: AgentDraft,
  models: readonly PageAgentModel[],
  agent: AgentEmployee | null,
): string {
  return JSON.stringify({
    displayName: draft.displayName,
    username: draft.username,
    position: draft.position,
    avatarColor: draft.avatarColor,
    roleId: draft.roleId,
    departments: draft.departments,
    ...selectionOf(draft, models, agent),
    reasoningEffort: draft.reasoningEffort,
    access: draft.access,
    soul: draft.soul,
    instructions: draft.instructions,
    memory: draft.memory,
    isLearningEnabled: draft.isLearningEnabled,
  });
}
