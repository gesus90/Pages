/** The agent API operations of the main model of a swarm. */
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

/** The memory operations of main model and helpers alike: read, publish and changes. */
export const AGENT_SWARM_MEMORY_OPERATIONS = [
  "run.swarm.memory.read",
  "run.swarm.memory.publish",
  "run.swarm.memory.changes",
] as const;

/** The memory operation of the main model only: consolidating the snapshot. */
export const AGENT_SWARM_MEMORY_MAIN_OPERATIONS = [
  "run.swarm.memory.compact",
] as const;

/** Every swarm operation, the memory operations included. */
export const AGENT_SWARM_OPERATIONS = [
  ...AGENT_SWARM_MAIN_OPERATIONS,
  ...AGENT_SWARM_WORKER_OPERATIONS,
  ...AGENT_SWARM_MEMORY_OPERATIONS,
  ...AGENT_SWARM_MEMORY_MAIN_OPERATIONS,
] as const;

/** Every swarm operation. */
export type AgentSwarmOperation = (typeof AGENT_SWARM_OPERATIONS)[number];

/** One of the operations of the shared memory of a swarm. */
export type AgentSwarmMemoryOperation =
  | (typeof AGENT_SWARM_MEMORY_OPERATIONS)[number]
  | (typeof AGENT_SWARM_MEMORY_MAIN_OPERATIONS)[number];

/** Whether an operation name is one of the swarm operations. */
export function isAgentSwarmOperation(
  operation: unknown,
): operation is AgentSwarmOperation {
  return AGENT_SWARM_OPERATIONS.some((entry) => entry === operation);
}

/** Whether a swarm operation belongs to the shared memory. */
export function isAgentSwarmMemoryOperation(
  operation: AgentSwarmOperation,
): operation is AgentSwarmMemoryOperation {
  return operation.startsWith("run.swarm.memory.");
}

/** The roles a swarm session credential can carry. */
export const AGENT_SWARM_ROLES = ["main", "worker"] as const;

/** Which side of a swarm a session credential serves. */
export type AgentSwarmRole = (typeof AGENT_SWARM_ROLES)[number];

/** The MCP tools of each side without the shared memory, by name. */
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

/** The MCP tools of the shared memory of each side, by name. */
export const AGENT_SWARM_MEMORY_TOOLS: Readonly<
  Record<AgentSwarmRole, readonly string[]>
> = {
  main: [
    "swarm_memory_read",
    "swarm_memory_publish",
    "swarm_memory_changes",
    "swarm_memory_compact",
  ],
  worker: ["swarm_memory_read", "swarm_memory_publish", "swarm_memory_changes"],
};

/** Whether a swarm session also gets the tools of the shared memory. */
export interface AgentSwarmAccessOptions {
  readonly hasMemory?: boolean;
}

/** The operations of each side; the memory operations only for a swarm with memory. */
export function agentSwarmOperations(
  role: AgentSwarmRole,
  options: AgentSwarmAccessOptions = {},
): readonly AgentSwarmOperation[] {
  const base =
    role === "main"
      ? AGENT_SWARM_MAIN_OPERATIONS
      : AGENT_SWARM_WORKER_OPERATIONS;
  if (options.hasMemory !== true) return base;
  return [
    ...base,
    ...AGENT_SWARM_MEMORY_OPERATIONS,
    ...(role === "main" ? AGENT_SWARM_MEMORY_MAIN_OPERATIONS : []),
  ];
}

/** The tool names of each side; the memory tools only for a swarm with memory. */
export function agentSwarmTools(
  role: AgentSwarmRole,
  options: AgentSwarmAccessOptions = {},
): readonly string[] {
  return [
    ...AGENT_SWARM_TOOLS[role],
    ...(options.hasMemory === true ? AGENT_SWARM_MEMORY_TOOLS[role] : []),
  ];
}

/** Which side may call an operation: one side only, or both for read, publish and changes. */
export function agentSwarmOperationSide(
  operation: AgentSwarmOperation,
): AgentSwarmRole | "both" {
  if (AGENT_SWARM_MEMORY_OPERATIONS.some((entry) => entry === operation))
    return "both";
  if (AGENT_SWARM_WORKER_OPERATIONS.some((entry) => entry === operation))
    return "worker";
  return "main";
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
