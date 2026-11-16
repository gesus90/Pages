import { markRunnerSupport } from "./RunnerServiceSupport";

import type { RunnerInterpreter } from "@/definition/RunnerExecution";
import type { ToolInventory } from "@/definition/RemoteSetup";
import type { RunnerMessage } from "@/definition/RunnerProtocol";
import type { RunnerHostFeatures } from "./RunnerHostFeatures";

/** The live capability collections a runner reconcile replaces. */
export interface RunnerCapabilitySets {
  readonly hostFeatures: RunnerHostFeatures;
  readonly communicationExecutors: Set<string>;
  readonly liveExecutors: Set<string>;
  readonly pagesExecutors: Map<string, 1 | 2 | 3>;
  readonly githubProbes: Set<string>;
  readonly cliExecutors: Set<string>;
  readonly openCodeExecutors: Set<string>;
  readonly exactPayloadExecutors: Set<string>;
  readonly continuationExecutors: Set<string>;
  readonly interpreters: Map<string, readonly RunnerInterpreter[]>;
  readonly tools: Map<string, readonly ToolInventory[]>;
}

/** Replaces every live capability of a connection from one reconcile message. */
export function rememberReconcileCapabilities(
  sets: RunnerCapabilitySets,
  connectionId: string,
  message: Extract<RunnerMessage, { type: "reconcile" }>,
): void {
  sets.hostFeatures.remember(connectionId, message);
  markRunnerSupport(
    sets.communicationExecutors,
    connectionId,
    message.communicationVersion === 1,
  );
  markRunnerSupport(
    sets.liveExecutors,
    connectionId,
    message.liveHistoryVersion === 1,
  );
  if (message.pagesAccessVersion)
    sets.pagesExecutors.set(connectionId, message.pagesAccessVersion);
  else sets.pagesExecutors.delete(connectionId);
  markRunnerSupport(
    sets.githubProbes,
    connectionId,
    message.githubAccessVersion === 1,
  );
  markRunnerSupport(
    sets.cliExecutors,
    connectionId,
    message.cliExecutorVersion === 1,
  );
  markRunnerSupport(
    sets.openCodeExecutors,
    connectionId,
    message.openCodeExecutorVersion === 1,
  );
  markRunnerSupport(
    sets.exactPayloadExecutors,
    connectionId,
    message.resultPayloadVersion === 1,
  );
  markRunnerSupport(
    sets.continuationExecutors,
    connectionId,
    message.continuationVersion === 1,
  );
  if (message.executorVersion === 1 && message.interpreters)
    sets.interpreters.set(connectionId, message.interpreters);
  if (message.tools) sets.tools.set(connectionId, message.tools);
  else sets.tools.delete(connectionId);
}
