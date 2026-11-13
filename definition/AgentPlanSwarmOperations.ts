/** The agent API operations of the main model of a swarm (PAGE-313). */
export const AGENT_SWARM_MAIN_OPERATIONS = [
  "run.swarm.assign",
  "run.swarm.status",
  "run.swarm.result",
  "run.swarm.cancel",
  "run.swarm.finish",
] as const;

/** The agent API operations of a helper of a swarm: lock, unlock and list locks. */
export const AGENT_SWARM_WORKER_OPERATIONS = [
  "run.swarm.lock",
  "run.swarm.unlock",
  "run.swarm.locks",
] as const;

/** Every swarm operation. */
export type AgentSwarmOperation =
  | (typeof AGENT_SWARM_MAIN_OPERATIONS)[number]
  | (typeof AGENT_SWARM_WORKER_OPERATIONS)[number];

/** Whether an operation name is one of the swarm operations. */
export function isAgentSwarmOperation(
  operation: unknown,
): operation is AgentSwarmOperation {
  return (
    AGENT_SWARM_MAIN_OPERATIONS.some((entry) => entry === operation) ||
    AGENT_SWARM_WORKER_OPERATIONS.some((entry) => entry === operation)
  );
}

/** Which side of a swarm a session credential serves. */
export type AgentSwarmRole = "main" | "worker";

/** The MCP tools of each side, by name. */
export const AGENT_SWARM_TOOLS: Readonly<
  Record<AgentSwarmRole, readonly string[]>
> = {
  main: [
    "swarm_assign",
    "swarm_status",
    "swarm_result",
    "swarm_cancel",
    "swarm_finish",
  ],
  worker: ["swarm_lock", "swarm_unlock", "swarm_locks"],
};

/** The operations of each side. */
export function agentSwarmOperations(
  role: AgentSwarmRole,
): readonly AgentSwarmOperation[] {
  return role === "main"
    ? AGENT_SWARM_MAIN_OPERATIONS
    : AGENT_SWARM_WORKER_OPERATIONS;
}

/** The step of a helper credential: the swarm node and the helper label. */
export function agentSwarmWorkerStep(nodeId: string, workerId: string): string {
  return `${nodeId}::${workerId}`;
}

/**
 * Splits the step of a swarm credential.
 *
 * @returns The swarm node and the helper, `null` as helper for the main model.
 */
export function readAgentSwarmStep(stepId: string): {
  readonly nodeId: string;
  readonly workerId: string | null;
} {
  const index = stepId.lastIndexOf("::");
  if (index < 0) return { nodeId: stepId, workerId: null };
  return { nodeId: stepId.slice(0, index), workerId: stepId.slice(index + 2) };
}

/** The longest wait of `swarm_status`, in seconds. */
export const AGENT_SWARM_STATUS_WAIT_SECONDS = 60;

/** What a swarm tool answers, under its own key so other results stay apart. */
export interface AgentSwarmToolResult {
  readonly swarm: unknown;
}
