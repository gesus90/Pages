import {
  isApiProvider,
  isOpenCodeLinkedProvider,
  openCodeLinkedModelProvider,
} from "@/definition/AgentConnection";
import { isPicaModel } from "@/definition/PicaModelSelection";

import { findOpenCodeLinks } from "../agents/OpenCodeProviderLinks";

import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AgentModelSelection } from "@/definition/AgentModelSelection";
import type { PageAgentModel } from "@/definition/PageAgent";

/** Offers exactly the same provider, model, key and effort, for explicit confirmation in settings. */
export async function picaSelectionAdoption(
  connections: AgentConnectionRepository,
  selection: AgentModelSelection | null,
  models: readonly PageAgentModel[],
): Promise<(PageAgentModel & AgentModelSelection) | null> {
  if (!selection) return null;
  const source = await connections.find(selection.connectionId);
  if (
    !source ||
    !isApiProvider(source.provider) ||
    !isOpenCodeLinkedProvider(source.provider)
  )
    return null;
  const link = (await findOpenCodeLinks(connections)).get(source.provider);
  if (!link?.isVerified || link.connection.id !== source.id) return null;
  const model = `${openCodeLinkedModelProvider({ ...source, provider: source.provider })}/${selection.model.replace(/^models\//u, "")}`;
  const matches = models.filter(
    (candidate) =>
      candidate.provider === "opencode" &&
      candidate.model === model &&
      isPicaModel(candidate) &&
      (selection.reasoningEffort === null ||
        candidate.reasoningEfforts.includes(selection.reasoningEffort)),
  );
  const match = matches.length === 1 ? matches[0] : null;
  return match?.connectionId
    ? {
        ...match,
        connectionId: match.connectionId,
        reasoningEffort: selection.reasoningEffort,
      }
    : null;
}
