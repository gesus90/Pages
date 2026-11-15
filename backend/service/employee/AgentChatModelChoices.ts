import { modelConsumerRefusal } from "@/definition/AgentModelConsumers";
import { isPicaModel } from "@/definition/PicaModelSelection";

import type { StoredAgentEmployee } from "@/backend/database/repositories/employee/AgentEmployeeRepository";
import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { AgentChatKind } from "@/definition/AgentChatSession";
import type {
  AgentChatModelChoice,
  AgentChatModelLabel,
  AgentChatModelSetting,
} from "@/definition/AgentChatControl";
import type { PageAgentModel } from "@/definition/PageAgent";
import type { AgentEmployeeModels } from "./AgentEmployeeModels";

/** What the model choice of a chat reads. */
export interface AgentChatModelChoicesDependencies {
  readonly models: Pick<AgentEmployeeModels, "models">;
}

/**
 * Whether a model of the catalog belongs in the choice of an agent in a chat:
 * a text model (text in, text alone out) that Pica would list and an agent
 * can run with its access. Decision, speech, transcription, image and other
 * special models stay out.
 *
 * @param model - A model of the shared catalog.
 * @param employee - The agent, whose access the rule of agents needs.
 */
export function isChatModelChoice(
  model: PageAgentModel,
  employee: Pick<StoredAgentEmployee, "access">,
): boolean {
  if (model.connectionId === undefined) return false;
  if (
    model.isSpeechOutputCapable === true ||
    model.isTranscriptionOnly === true ||
    model.isDecisionCapable === true ||
    model.isSpeechCapable === true
  )
    return false;
  return (
    isPicaModel(model) &&
    modelConsumerRefusal("employee", model, {
      employeeAccess: employee.access,
    }) === null
  );
}

function toChoice(model: PageAgentModel): AgentChatModelChoice {
  return {
    connectionId: model.connectionId ?? "",
    model: model.model,
    name: model.modelName ?? model.name,
    connectionName: model.connectionName ?? model.provider,
    provider: model.provider,
    reasoningEfforts: model.reasoningEfforts,
    defaultReasoningEffort: model.catalogDefaultReasoningEffort,
    contextWindow: model.contextWindow ?? null,
    aliases: model.aliases ?? [],
  };
}

/**
 * The models an agent can answer with in one chat (PAGE-380).
 *
 * @remarks
 * The choice holds the text models of every connection the agent's own
 * account may use, filtered as Pica's choice is ({@link isPicaModel}) and by
 * the rule of agents. The reasoning levels come from the catalog of each
 * model.
 */
export class AgentChatModelChoices {
  private readonly dependencies: AgentChatModelChoicesDependencies;

  public constructor(dependencies: AgentChatModelChoicesDependencies) {
    this.dependencies = dependencies;
  }

  /** The models of the choice for an agent, in the order of the catalog. */
  public async choices(
    employee: Pick<StoredAgentEmployee, "userId" | "access">,
  ): Promise<AgentChatModelChoice[]> {
    const models = await this.dependencies.models.models(employee.userId);
    return models
      .filter((model) => isChatModelChoice(model, employee))
      .map(toChoice);
  }

  /**
   * The choice a setting names, with a reasoning level the model offers.
   *
   * @returns `null` for a model outside the choice or a level the model does
   * not offer.
   */
  public pick(
    choices: readonly AgentChatModelChoice[],
    setting: AgentChatModelSetting,
  ): AgentChatModelChoice | null {
    const choice = choices.find(
      (entry) =>
        entry.connectionId === setting.connectionId &&
        entry.model === setting.model,
    );
    if (!choice) return null;
    if (
      setting.reasoningEffort !== null &&
      !choice.reasoningEfforts.includes(setting.reasoningEffort)
    )
      return null;
    return choice;
  }
}

/**
 * How a model of an agent in a chat reads, with the choice that names it.
 *
 * @param setting - The model the agent answers with.
 * @param choices - The models of the choice; a model missing there keeps its ID.
 * @param isOverride - Whether the chat deviates from the agent's own model.
 */
export function chatModelLabel(
  setting: AgentChatModelSetting,
  choices: readonly AgentChatModelChoice[],
  isOverride: boolean,
): AgentChatModelLabel {
  const choice = choices.find(
    (entry) =>
      entry.connectionId === setting.connectionId &&
      entry.model === setting.model,
  );
  return {
    name: choice?.name ?? setting.model,
    reasoningEffort: setting.reasoningEffort,
    isOverride,
    contextWindow: choice?.contextWindow ?? null,
  };
}

/** What the labels of the models of agents in a chat read. */
export interface AgentChatModelLabelDependencies {
  readonly store: EmployeeStore;
  readonly models: Pick<AgentEmployeeModels, "describe">;
}

/**
 * How the agents of one chat read in its head and its context rings
 * (PAGE-380): the model each one answers with there, its own or the one the
 * chat chose.
 *
 * @param dependencies - The stores of the agents and their models.
 * @param chat - The direct chat of a person or a group, with its agents.
 * @returns The label of every agent the store knows, by agent.
 */
export async function chatModelLabels(
  dependencies: AgentChatModelLabelDependencies,
  chat: {
    readonly kind: AgentChatKind;
    readonly chatId: string;
    readonly agentIds: readonly string[];
  },
): Promise<Record<string, AgentChatModelLabel>> {
  const { store, models } = dependencies;
  const overrides =
    chat.agentIds.length === 0
      ? []
      : await store.chatModels().forChat(chat.kind, chat.chatId);
  const labels: Record<string, AgentChatModelLabel> = {};
  for (const agentId of chat.agentIds) {
    const override = overrides.find((entry) => entry.agentId === agentId);
    const setting = override ?? (await store.employees().find(agentId));
    if (!setting) continue;
    const description = await models.describe(setting);
    labels[agentId] = {
      name: description.modelName,
      reasoningEffort: setting.reasoningEffort,
      isOverride: override !== undefined,
      contextWindow: null,
    };
  }
  return labels;
}
