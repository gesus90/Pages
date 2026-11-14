import { requireAgentFiles } from "@/backend/storage/AgentPayloadFileStore";

import { localMutationSchema } from "./LocalSessionContracts";

import type { Database } from "@/backend/database/Database";
import type { LocalSessionRepository } from "@/backend/database/repositories/agent/LocalSessionRepository";
import type { LocalSessionMutation } from "./LocalSessionContracts";

/** Reads the stored result of a native session turn, if it has one. */
export async function readLocalCompletion(
  owners: Pick<LocalSessionRepository, "result">,
  database: Database,
  instanceId: string,
  turnId: string,
): Promise<LocalSessionMutation | null> {
  const reference = await owners.result(instanceId, turnId);
  return reference
    ? localMutationSchema.parse(
        JSON.parse(await requireAgentFiles(database).read(reference)),
      )
    : null;
}
