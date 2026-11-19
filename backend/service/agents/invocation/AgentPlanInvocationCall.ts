import { createHash } from "node:crypto";

import { AgentError } from "@/backend/error/AgentErrors";
import { canRunPlan } from "@/definition/AgentPlanTeam";
import { planStartIssues } from "@/definition/AgentPlanStart";
import { planEntryContract } from "@/definition/AgentPlanJump";
import { requireManagementScriptExecution } from "@/backend/service/management/ManagementPlanAccess";

import { resolveNodeValues } from "./AgentPlanInvocationBindings";
import { applyEntryContract } from "./AgentPlanInvocationValues";

import type {
  AgentPlanInvocationRecord,
  AgentPlanInvocationRepository,
} from "@/backend/database/repositories/agent/AgentPlanInvocationRepository";
import type { AgentPlanJumpOut } from "@/definition/AgentPlanJump";
import type { AgentPlanAccess } from "../AgentPlanAccess";
import type { ActivePlanRun } from "../AgentPlanRunState";

/** What the creation of a call needs. */
export interface InvocationCallDependencies {
  readonly invocations: Pick<
    AgentPlanInvocationRepository,
    "create" | "findBySource" | "findByTargetRun"
  >;
  readonly access: Pick<AgentPlanAccess, "require">;
}

/** The identity of this activation of a Jump node. */
export function callIdentity(
  active: ActivePlanRun,
  node: AgentPlanJumpOut,
): { readonly id: string; readonly activation: number; readonly key: string } {
  const activation =
    active.view.steps.find((step) => step.id === node.id)?.activation ?? 1;
  const key = invocationActivationKey(activation);
  return { id: invocationId(active.view.id, node.id, key), activation, key };
}

/** The time a wait of this Jump ends, or `null` for a call that goes on at once or waits without limit. */
function deadlineOf(node: AgentPlanJumpOut, now: Date): string | null {
  if (node.wait === "continue" || node.timeout.kind !== "minutes") return null;
  return new Date(now.getTime() + node.timeout.minutes * 60_000).toISOString();
}

/**
 * Stores the call of one activation of an outgoing Jump, or finds the one that is already stored.
 * @param active - The calling run.
 * @param node - The Jump node.
 * @param dependencies - The register and the plan access.
 * @throws {AgentError} `plan_jump_target_unavailable` when the person who runs the calling plan may not
 * read and run the target, `plan_jump_entry_unavailable` for an entry that
 * is gone, switched off, no entry or without a path to an end,
 * `plan_jump_cycle` for a call inside its own chain, `plan_jump_input_invalid`,
 * `plan_jump_interface_changed` or `plan_jump_payload_limit` for the values.
 * @remarks
 * The target is read and judged as the executor of the calling run, not as its
 * owner, and again when its run is created. Its revision and interface are
 * frozen into the call; a later edit of the target changes nothing here.
 */
export async function findOrCreateCall(
  active: ActivePlanRun,
  node: AgentPlanJumpOut,
  dependencies: InvocationCallDependencies,
): Promise<AgentPlanInvocationRecord> {
  const identity = callIdentity(active, node);
  const known = await dependencies.invocations.findBySource(
    active.view.id,
    node.id,
    identity.key,
  );
  if (known) return known;
  const { target } = node;
  if (!target) throw new AgentError("plan_jump_target_unavailable");
  const plan = await dependencies.access
    .require(active.view.userId, target.planId)
    .catch((error: unknown) => {
      if (error instanceof AgentError)
        throw new AgentError("plan_jump_target_unavailable");
      throw error;
    });
  if (!canRunPlan(plan)) throw new AgentError("plan_jump_target_unavailable");
  requireManagementScriptExecution(plan.rights?.canReadAllRuns === true, plan);
  const contract = planEntryContract(plan, target.entryNodeId);
  if (
    !contract ||
    contract.hasReturnConflict ||
    planStartIssues(plan, target.entryNodeId).length > 0
  )
    throw new AgentError("plan_jump_entry_unavailable");
  await requireNoCallCycle(
    dependencies.invocations,
    { runId: active.view.id, planId: active.view.planId },
    plan.id,
  );
  const inputs = applyEntryContract(
    contract.inputs,
    resolveNodeValues(active, contract.inputs, node.bindings),
  );
  const now = new Date();
  const created = await dependencies.invocations.create(
    {
      id: identity.id,
      sourcePlanId: active.view.planId,
      sourceRunId: active.view.id,
      sourceNodeId: node.id,
      activation: identity.activation,
      iteration: null,
      activationKey: identity.key,
      userId: active.view.userId,
      targetPlanId: plan.id,
      targetRevision: plan.revision,
      entryNodeId: target.entryNodeId,
      inputs,
      contract: { inputs: contract.inputs, returns: contract.returns },
      wait: node.wait,
      signalName: node.wait === "signal" ? (node.signalName ?? null) : null,
      workspace: node.workspace,
      deadlineAt: deadlineOf(node, now),
    },
    now.toISOString(),
  );
  return created.record;
}

const CHAIN_LIMIT = 64;

async function requireNoCallCycle(
  invocations: Pick<AgentPlanInvocationRepository, "findByTargetRun">,
  source: { readonly runId: string; readonly planId: string },
  targetPlanId: string,
): Promise<void> {
  const plans = new Set([source.planId]);
  let runId = source.runId;
  for (let depth = 0; depth < CHAIN_LIMIT; depth += 1) {
    const call = await invocations.findByTargetRun(runId);
    if (!call) break;
    plans.add(call.sourcePlanId);
    runId = call.sourceRunId;
  }
  if (plans.has(targetPlanId)) throw new AgentError("plan_jump_cycle");
}

function invocationActivationKey(
  activation: number,
  iteration?: number | null,
): string {
  return iteration === undefined || iteration === null
    ? `${activation}`
    : `${activation}:${iteration}`;
}

function invocationId(
  sourceRunId: string,
  sourceNodeId: string,
  activationKey: string,
): string {
  const hex = createHash("sha256")
    .update(JSON.stringify([sourceRunId, sourceNodeId, activationKey]))
    .digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
