import { z } from "zod";

import { AgentError } from "@/backend/error/AgentErrors";
import { ACP_PROVIDERS } from "@/definition/AgentConfiguration";
import { planExecutionTargetSchema } from "@/definition/AgentPlanExecution";
import {
  PLAN_SWARM_ACCESS_MODES,
  PLAN_SWARM_TEXT_LENGTH,
  PLAN_SWARM_WORKER_LIMIT,
  planSwarmSaveIssue,
} from "@/definition/AgentPlanSwarm";

import type {
  AgentPlanBinding,
  AgentPlanInput,
  AgentPlanPosition,
} from "@/definition/AgentPlan";
import type { AgentPlanSwarm } from "@/definition/AgentPlanSwarm";

const identifier = z.string().trim().min(1).max(200);

const modelSchema = z
  .strictObject({
    connectionId: identifier,
    provider: z.enum(ACP_PROVIDERS),
    model: identifier,
    reasoningEffort: z.string().max(100).nullable(),
  })
  .nullable();

const workerSchema = z.strictObject({
  model: modelSchema,
  access: z.enum(PLAN_SWARM_ACCESS_MODES),
});

const instruction = z
  .string()
  .max(PLAN_SWARM_TEXT_LENGTH.instruction)
  .optional();

/** The fields of a swarm node besides position, identifier and bindings. */
const swarmSchema = z.strictObject({
  id: z.unknown(),
  x: z.unknown(),
  y: z.unknown(),
  type: z.literal("swarm"),
  bindings: z.unknown(),
  name: z.string().trim().min(1).max(PLAN_SWARM_TEXT_LENGTH.name).optional(),
  task: z.discriminatedUnion("source", [
    z.strictObject({
      source: z.literal("text"),
      text: z.string().max(PLAN_SWARM_TEXT_LENGTH.task),
    }),
    z.strictObject({ source: z.literal("ticket") }),
  ]),
  main: z.strictObject({
    model: modelSchema,
    access: z.enum(PLAN_SWARM_ACCESS_MODES),
    instruction,
  }),
  workers: z.strictObject({
    count: z.number().int(),
    mode: z.enum(["same", "individual"]),
    same: workerSchema,
    individual: z.array(workerSchema).max(PLAN_SWARM_WORKER_LIMIT),
    instruction,
  }),
  directory: z.string().max(PLAN_SWARM_TEXT_LENGTH.directory).optional(),
  timeoutMinutes: z.number().int(),
  executionTarget: planExecutionTargetSchema.optional(),
});

/**
 * Parses a swarm node (PAGE-313); its own settings are checked completely here.
 *
 * @param node - The untrusted node.
 * @param base - Its checked identifier and position.
 * @param readBindings - Parses the bindings like those of every other node.
 * @throws {AgentError} `swarm_invalid` for a missing or malformed field, a
 * helper count outside 1–10, a time limit outside 1–1440 minutes or a
 * directory outside the workspace.
 */
export function readPlanSwarmNode(
  node: Readonly<Record<string, unknown>>,
  base: AgentPlanPosition & { readonly id: string },
  readBindings: (input: unknown) => Readonly<Record<string, AgentPlanBinding>>,
): AgentPlanSwarm {
  const parsed = swarmSchema.safeParse(node);
  if (!parsed.success) throw new AgentError("swarm_invalid");
  const { name, task, main, workers, directory, timeoutMinutes } = parsed.data;
  const swarm: AgentPlanSwarm = {
    ...base,
    type: "swarm",
    ...(name ? { name } : {}),
    task,
    main: {
      model: main.model,
      access: main.access,
      ...(main.instruction?.trim() ? { instruction: main.instruction } : {}),
    },
    workers: {
      count: workers.count,
      mode: workers.mode,
      same: workers.same,
      individual: workers.individual,
      ...(workers.instruction?.trim()
        ? { instruction: workers.instruction }
        : {}),
    },
    ...(directory?.trim() ? { directory: directory.trim() } : {}),
    timeoutMinutes,
    ...(parsed.data.executionTarget
      ? { executionTarget: parsed.data.executionTarget }
      : {}),
    bindings: readBindings(node.bindings),
  };
  const issue = planSwarmSaveIssue(swarm, {});
  if (issue !== null && issue !== "swarm_remote_unsupported")
    throw new AgentError("swarm_invalid");
  return swarm;
}

/**
 * Refuses a plan whose swarm would run away from the Pages host.
 *
 * @throws {AgentError} `swarm_remote_unsupported` when a swarm names a remote
 * target or inherits one from the plan; a save is never silently accepted.
 * @returns The plan, unchanged.
 */
export function requireLocalPlanSwarms(plan: AgentPlanInput): AgentPlanInput {
  for (const node of plan.nodes)
    if (
      node.type === "swarm" &&
      planSwarmSaveIssue(node, plan) === "swarm_remote_unsupported"
    )
      throw new AgentError("swarm_remote_unsupported");
  return plan;
}
