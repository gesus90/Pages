import { preparePlanTemporaryDirectory } from "../PlanRunTemporaryDirectory";

import type { AgentPlanSessionInput } from "@/backend/agents/AgentPlanExecution";
import type { CliSessionRequest } from "./CliContracts";

/**
 * Attaches the disk-backed temporary directory of a plan step to a worker.
 * @remarks
 * The read-only namespace mounts it as `/tmp`; a native YOLO worker gets it
 * through `TMPDIR` and its siblings instead, without any mount. A chat keeps
 * no step directory.
 */
export async function attachPlanTemporaryDirectory(
  worker: CliSessionRequest,
  input: AgentPlanSessionInput,
): Promise<CliSessionRequest> {
  const context = input.resourceContext;
  if (!context || input.chat) return worker;
  return {
    ...worker,
    temporaryDirectory: await preparePlanTemporaryDirectory({
      runId: context.runId,
      stepId: context.sessionScopeId ?? context.stepId,
    }),
  };
}
