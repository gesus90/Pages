import { AGENT_PROVIDERS } from "./AgentConnection";
import { supportsModelCatalog } from "./AgentModelCatalog";
import { isChatCapableModel } from "./AgentModelFilter";
import { agentModelKey } from "./AgentPlanConfiguration";
import { isSpeechSynthesisModel } from "./SpeechSynthesis";

import type { AgentProviderId } from "./AgentConnection";
import type { AgentCatalogModel } from "./AgentModelCatalog";
import type { PageAgentModel } from "./PageAgent";

/** The connection a catalog model belongs to, as far as a model choice names it. */
export interface AgentModelChoiceConnection {
  readonly id: string;
  readonly name: string;
  readonly provider: AgentProviderId;
}

/**
 * One catalog model of one connection as an entry of the shared model choice.
 *
 * @remarks
 * The server lists the models a person may use with this projection, and the
 * agent profile editor turns the catalogs it loaded into the same entries,
 * so every model choice of Pages names, groups and filters a model alike.
 *
 * @param connection - The connection whose catalog lists the model.
 * @param model - The stored catalog entry.
 * @returns The entry under the selection key of connection and model.
 */
export function catalogModelChoice(
  connection: AgentModelChoiceConnection,
  model: AgentCatalogModel,
): PageAgentModel {
  return {
    id: agentModelKey(connection.id, model.id),
    connectionId: connection.id,
    name: `${model.name} · ${connection.name}`,
    modelName: model.name,
    connectionName: connection.name,
    location: AGENT_PROVIDERS[connection.provider].location,
    model: model.id,
    provider: connection.provider,
    reasoning: model.reasoning,
    reasoningEfforts: model.reasoningEfforts,
    catalogDefaultReasoningEffort: model.defaultReasoningEffort,
    reasoningEffort: null,
    isManual: !supportsModelCatalog(connection.provider),
    ...(model.aliases ? { aliases: model.aliases } : {}),
    ...(model.promptPrice === null && model.completionPrice === null
      ? {}
      : { isFree: model.isFree }),
    ...(model.isToolCapable === undefined
      ? {}
      : { isToolCapable: model.isToolCapable }),
    ...(isChatCapableModel(model) ? {} : { isChatCapable: false }),
    // Marked everywhere, so Pica, agents and plans refuse it on the server too (PAGE-300).
    ...(isSpeechSynthesisModel(model) ? { isSpeechOutputCapable: true } : {}),
  };
}
