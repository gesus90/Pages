import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AgentModelSelection } from "@/definition/AgentModelSelection";
import type { PageAgentModel } from "@/definition/PageAgent";

/** API selections have no equivalent linked OpenCode access; Pica keeps its own adapter policy. */
export async function picaSelectionAdoption(
  connections: AgentConnectionRepository,
  selection: AgentModelSelection | null,
  models: readonly PageAgentModel[],
): Promise<(PageAgentModel & AgentModelSelection) | null> {
  // Keep the caller contract while API connections remain API-only for chat.
  void connections;
  void selection;
  void models;
  return null;
}
