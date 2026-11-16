import { z } from "zod";

/**
 * The limits of the shared memory of a swarm.
 * @remarks
 * Characters are Unicode code points, so an umlaut or an emoji counts once.
 * The entry and snapshot limits apply after secrets were blacked out.
 */
export const PLAN_SWARM_MEMORY_LIMITS = {
  /** The longest text of one entry. */
  entryCharacters: 2000,
  /** The most entries of one swarm node in one run. */
  nodeEntries: 300,
  /** The most entries one helper publishes in one run. */
  workerEntries: 60,
  /** The longest consolidated snapshot of the main model. */
  snapshotCharacters: 6000,
  /** The most entries a tool answer appends. */
  appendedEntries: 5,
  /** The most characters of the entries a tool answer appends. */
  appendedCharacters: 1500,
  /** The most characters of the entries that open a further turn. */
  turnCharacters: 3000,
  /** The most open contradictions the main model names in a snapshot. */
  contradictions: 10,
  /** The longest text of one open contradiction. */
  contradictionCharacters: 300,
  /** The most refused entries one node keeps for the activity view. */
  rejections: 100,
  /** The most entries one `swarm_memory_changes` answer returns. */
  changesPage: 50,
} as const;

/** Every kind of memory entry. */
export const PLAN_SWARM_MEMORY_KINDS = [
  "finding",
  "blocker",
  "handoff",
  "proposal",
  "decision",
  "interface",
  "status",
] as const;

/** One of {@link PLAN_SWARM_MEMORY_KINDS}. */
export type AgentPlanSwarmMemoryKind = (typeof PLAN_SWARM_MEMORY_KINDS)[number];

/** The kinds a helper may publish; the others belong to the main model. */
export const PLAN_SWARM_MEMORY_WORKER_KINDS: readonly AgentPlanSwarmMemoryKind[] =
  ["finding", "blocker", "handoff", "proposal"];

/** The kinds that wake a waiting `swarm_status` of the main model. */
export const PLAN_SWARM_MEMORY_WAKING_KINDS: readonly AgentPlanSwarmMemoryKind[] =
  ["blocker", "handoff"];

/** The text that stands in a stored entry where a secret was blacked out. */
export const PLAN_SWARM_MEMORY_REDACTED = "[redacted]";

/** The memory setting of a swarm node as the plan stores it. */
export interface AgentPlanSwarmMemorySetting {
  /** Whether the run gets a shared memory. */
  readonly enabled: boolean;
  /** Whether helpers publish entries; without it they only read. */
  readonly workersPublish: boolean;
  /** Whether the entries stay after a finished or cancelled run. */
  readonly keepAfterEnd: boolean;
}

/** The fewest helpers with which the memory is on unless the node says otherwise. */
export const PLAN_SWARM_MEMORY_MIN_WORKERS = 2;

/**
 * The memory setting a swarm node runs with.
 * @param node - The helper count and the stored setting, absent in older plans.
 * @returns The stored setting; without one the memory is on from two helpers.
 * With one helper the two options below the switch are locked at their default.
 */
export function planSwarmMemorySetting(node: {
  readonly workers: { readonly count: number };
  readonly memory?: AgentPlanSwarmMemorySetting;
}): AgentPlanSwarmMemorySetting {
  const hasSeveral = node.workers.count >= PLAN_SWARM_MEMORY_MIN_WORKERS;
  const stored = node.memory;
  return {
    enabled: stored?.enabled ?? hasSeveral,
    workersPublish: hasSeveral ? (stored?.workersPublish ?? true) : true,
    keepAfterEnd: hasSeveral ? (stored?.keepAfterEnd ?? true) : true,
  };
}

/** The number of Unicode code points of a text. */
export function memoryCharacters(text: string): number {
  return Array.from(text).length;
}

const author = z.string().regex(/^(?:main|H(?:[1-9]|10))$/u);
const text = (maximum: number): z.ZodString => z.string().max(maximum);

/** One stored entry of the shared memory. */
export const planSwarmMemoryEntrySchema = z.strictObject({
  revision: z.number().int().min(1),
  eventId: text(100),
  author,
  kind: z.enum(PLAN_SWARM_MEMORY_KINDS),
  text: text(PLAN_SWARM_MEMORY_LIMITS.entryCharacters * 2),
  isRedacted: z.boolean(),
  /** The snapshot version that marked it superseded; `null` while it holds. */
  supersededBy: z.number().int().nullable(),
  createdAt: text(40),
});

/** One stored entry of the shared memory. */
export type AgentPlanSwarmMemoryEntry = z.infer<
  typeof planSwarmMemoryEntrySchema
>;

/** An entry Pages refused, with its reason, for the activity view. */
export const planSwarmMemoryRejectionSchema = z.strictObject({
  author,
  kind: text(40),
  text: text(PLAN_SWARM_MEMORY_LIMITS.entryCharacters * 2),
  reason: text(80),
  createdAt: text(40),
});

/** An entry Pages refused, with its reason. */
export type AgentPlanSwarmMemoryRejection = z.infer<
  typeof planSwarmMemoryRejectionSchema
>;

/** The consolidated snapshot of the main model. */
export const planSwarmMemorySnapshotSchema = z.strictObject({
  text: text(PLAN_SWARM_MEMORY_LIMITS.snapshotCharacters * 2),
  /** The newest revision the snapshot covers. */
  revision: z.number().int().min(0),
  /** Counts every consolidation; a compact names the version it saw. */
  version: z.number().int().min(0),
  contradictions: z
    .array(text(PLAN_SWARM_MEMORY_LIMITS.contradictionCharacters * 2))
    .max(PLAN_SWARM_MEMORY_LIMITS.contradictions),
  updatedAt: text(40).nullable(),
});

/** The consolidated snapshot of the main model. */
export type AgentPlanSwarmMemorySnapshot = z.infer<
  typeof planSwarmMemorySnapshotSchema
>;

/** Up to which revision one agent has read. */
export const planSwarmMemoryReadSchema = z.strictObject({
  agent: author,
  revision: z.number().int().min(0),
});

/** Up to which revision one agent has read. */
export type AgentPlanSwarmMemoryRead = z.infer<
  typeof planSwarmMemoryReadSchema
>;

/** The shared memory of one swarm node in one run, as the run view shows it. */
export const planSwarmMemoryViewSchema = z.strictObject({
  revision: z.number().int().min(0),
  snapshot: planSwarmMemorySnapshotSchema,
  entries: z
    .array(planSwarmMemoryEntrySchema)
    .max(PLAN_SWARM_MEMORY_LIMITS.nodeEntries),
  rejections: z
    .array(planSwarmMemoryRejectionSchema)
    .max(PLAN_SWARM_MEMORY_LIMITS.rejections),
  reads: z.array(planSwarmMemoryReadSchema).max(11),
});

/** The shared memory of one swarm node in one run. */
export type AgentPlanSwarmMemoryView = z.infer<
  typeof planSwarmMemoryViewSchema
>;

/** The two files the export of a memory produces. */
export const PLAN_SWARM_MEMORY_FILES = ["SWARM.md", "SWARM-LOG.md"] as const;

/** One of {@link PLAN_SWARM_MEMORY_FILES}. */
export type AgentPlanSwarmMemoryFile = (typeof PLAN_SWARM_MEMORY_FILES)[number];

/** An empty memory, as a run without entries shows it. */
export function emptyPlanSwarmMemory(): AgentPlanSwarmMemoryView {
  return {
    revision: 0,
    snapshot: {
      text: "",
      revision: 0,
      version: 0,
      contradictions: [],
      updatedAt: null,
    },
    entries: [],
    rejections: [],
    reads: [],
  };
}
