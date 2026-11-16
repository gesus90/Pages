import { z } from "zod";

import {
  PLAN_SWARM_MEMORY_KINDS,
  PLAN_SWARM_MEMORY_LIMITS,
} from "@/definition/AgentPlanSwarmMemory";

import type { AgentSwarmMemoryOperation } from "@/definition/AgentPlanSwarmOperations";
import type { AgentPlanSwarmMemoryKind } from "@/definition/AgentPlanSwarmMemory";
import type { SwarmMemory, SwarmMemoryAgent } from "./SwarmMemory";

/** Why the input of a memory call cannot be used; the registry maps it to `INVALID_REQUEST`. */
export class SwarmMemoryInputError extends Error {
  public constructor() {
    super("Swarm memory call input is invalid");
    this.name = "SwarmMemoryInputError";
  }
}

/** What the coordinator learns from a memory call, so the board view and waiting calls follow. */
export interface SwarmMemoryEffect {
  /** The kind of a newly published entry; a blocker or handoff wakes `swarm_status`. */
  readonly publishedKind: AgentPlanSwarmMemoryKind | null;
  /** The newest revision after the call, when the call knows it. */
  readonly revision: number | null;
}

const inputs = {
  "run.swarm.memory.read": z.strictObject({}),
  "run.swarm.memory.publish": z.strictObject({
    kind: z.enum(PLAN_SWARM_MEMORY_KINDS),
    text: z
      .string()
      .min(1)
      .max(PLAN_SWARM_MEMORY_LIMITS.entryCharacters * 2),
    eventId: z.string().min(1).max(100).optional(),
  }),
  "run.swarm.memory.changes": z.strictObject({
    sinceRevision: z.number().int().min(0).optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(PLAN_SWARM_MEMORY_LIMITS.changesPage)
      .optional(),
  }),
  "run.swarm.memory.compact": z.strictObject({
    expectedVersion: z.number().int().min(0),
    snapshot: z.string().max(PLAN_SWARM_MEMORY_LIMITS.snapshotCharacters * 2),
    contradictions: z
      .array(
        z
          .string()
          .min(1)
          .max(PLAN_SWARM_MEMORY_LIMITS.contradictionCharacters * 2),
      )
      .max(PLAN_SWARM_MEMORY_LIMITS.contradictions)
      .optional(),
    supersede: z
      .array(z.number().int().min(1))
      .max(PLAN_SWARM_MEMORY_LIMITS.nodeEntries)
      .optional(),
  }),
} as const;

function parse<Input>(schema: z.ZodType<Input>, parameters: unknown): Input {
  const parsed = schema.safeParse(parameters ?? {});
  if (!parsed.success) throw new SwarmMemoryInputError();
  return parsed.data;
}

function revisionOf(result: unknown): number | null {
  if (typeof result !== "object" || result === null) return null;
  const revision: unknown = Reflect.get(result, "revision");
  return typeof revision === "number" ? revision : null;
}

/**
 * Runs one memory tool call for the agent its credential names.
 * @throws {SwarmMemoryInputError} For input outside the tool schema.
 */
export async function answerSwarmMemoryCall(
  memory: SwarmMemory,
  agent: SwarmMemoryAgent,
  call: {
    readonly operation: AgentSwarmMemoryOperation;
    readonly parameters: unknown;
  },
): Promise<{ readonly result: unknown; readonly effect: SwarmMemoryEffect }> {
  switch (call.operation) {
    case "run.swarm.memory.read": {
      parse(inputs[call.operation], call.parameters);
      const result = await memory.read(agent);
      return {
        result,
        effect: { publishedKind: null, revision: revisionOf(result) },
      };
    }
    case "run.swarm.memory.publish": {
      const input = parse(inputs[call.operation], call.parameters);
      const result = await memory.publish(agent, input);
      const isNew = result.status === "published";
      return {
        result,
        effect: {
          publishedKind: isNew ? result.entry.kind : null,
          revision: isNew ? result.entry.revision : null,
        },
      };
    }
    case "run.swarm.memory.changes": {
      const input = parse(inputs[call.operation], call.parameters);
      const result = await memory.changes(agent, input);
      return {
        result,
        effect: { publishedKind: null, revision: revisionOf(result) },
      };
    }
    case "run.swarm.memory.compact": {
      const input = parse(inputs[call.operation], call.parameters);
      const result = await memory.compact(agent, {
        expectedVersion: input.expectedVersion,
        snapshot: input.snapshot,
        contradictions: input.contradictions ?? [],
        supersede: input.supersede ?? [],
      });
      return {
        result,
        effect: { publishedKind: null, revision: revisionOf(result) },
      };
    }
  }
}

/**
 * Appends the memory changes to a tool answer under its own key.
 * @returns The answer unchanged when nothing is new.
 */
export function withMemoryChanges(result: unknown, changes: unknown): unknown {
  if (changes === null) return result;
  if (typeof result === "object" && result !== null && !Array.isArray(result))
    return { ...result, memoryChanges: changes };
  return { result, memoryChanges: changes };
}
