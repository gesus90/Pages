import { expect, vi } from "vitest";

import { fingerprintOperation } from "@/backend/service/agents/AgentOperationRecorder";
import { AgentPlanCommandOperations } from "@/backend/service/agents/AgentPlanCommandOperations";
import { readPlanCommand } from "@/backend/service/agents/AgentPlanCommandInput";

import { TRANSACTION, world } from "./agent-plan-command-fakes";

import type { AgentPlanCommandOperation } from "@/definition/AgentPlanOperations";

export { TRANSACTION, world };
export const USER = "user-1";
/** Matches a journal callback of any shape. */
export const ANY_FUNCTION: unknown = expect.any(Function);
export const CONTROL = { planId: "plan-1", status: "idle", marker: "control" };

export const plans = {
  view: vi.fn(),
  clone: vi.fn(),
  remove: vi.fn(),
  play: vi.fn(),
  resume: vi.fn(),
  pause: vi.fn(),
  stop: vi.fn(),
  run: vi.fn(),
  controlRun: vi.fn(),
  checkNodes: vi.fn(),
};
export const templates = { list: vi.fn(), save: vi.fn() };
export const database = {
  transaction: vi.fn((work: (transaction: unknown) => unknown) =>
    work(TRANSACTION),
  ),
};

/**
 * Builds a saved plan as the plan service views it.
 *
 * @param changes - Fields that differ from an editable, owned plan at revision 3.
 * @returns The plan view.
 */
export function plan(
  changes: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "plan-1",
    revision: 3,
    ownerId: USER,
    workspaceId: "workspace-1",
    canEdit: true,
    nodes: [],
    ...changes,
  };
}

/**
 * Builds a running run of the plan.
 *
 * @param changes - Fields that differ from the default run.
 * @returns The run.
 */
export function run(
  changes: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "run-1",
    planId: "plan-1",
    userId: USER,
    status: "running",
    planRevision: 3,
    ...changes,
  };
}

/**
 * Creates the unit under test on top of the stand-ins.
 *
 * @returns The command operations.
 */
export function operations(): AgentPlanCommandOperations {
  return new AgentPlanCommandOperations({
    database: database as never,
    plans: plans as never,
    templates: templates as never,
  });
}

/**
 * Builds the input of a command.
 *
 * @param operation - The command.
 * @param extra - Fields that replace or extend the default input.
 * @returns The raw parameters.
 */
export function request(
  operation: AgentPlanCommandOperation,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const base = { operationId: "op-1", planId: "plan-1", expectedRevision: 3 };
  if (operation === "plans.clone") return { ...base, name: "Copy", ...extra };
  if (operation === "plans.templates.save")
    return { ...base, nodeId: "node-1", name: "Template", ...extra };
  if (["plans.pause", "plans.resume", "plans.stop"].includes(operation))
    return { ...base, runId: "run-1", ...extra };
  return { ...base, ...extra };
}

/**
 * Stores what an earlier call of the same request would have committed.
 *
 * @param operation - The command of the earlier call.
 * @param result - The result it stored.
 * @param input - Its raw parameters.
 */
export function storeEarlier(
  operation: AgentPlanCommandOperation,
  result: unknown,
  input: Record<string, unknown> = request(operation),
): void {
  world.keys.set(String(input.operationId), {
    operation,
    fingerprint: fingerprintOperation(readPlanCommand(operation, input)),
    resultJson: JSON.stringify(result),
  });
}

/**
 * Reads the result stored under an operation ID.
 *
 * @param operationId - The operation ID.
 * @returns The parsed result, or `undefined` when nothing was stored.
 */
export function stored(operationId = "op-1"): unknown {
  const entry = world.keys.get(operationId);
  return entry ? JSON.parse(entry.resultJson) : undefined;
}

/**
 * Runs the journal a plan service call received as its last argument.
 *
 * @param args - The arguments the service call received.
 * @param entry - What the service hands to the journal after the transaction.
 */
export async function runJournal(
  args: readonly unknown[],
  ...entry: unknown[]
): Promise<void> {
  const journal = args[args.length - 1] as (
    ...input: unknown[]
  ) => Promise<void>;
  await journal(TRANSACTION, ...entry);
}

/** Resets every stand-in to the state of an editable plan with a running run. */
export function resetWorld(): void {
  vi.resetAllMocks();
  world.keys.clear();
  world.findOverride = null;
  database.transaction.mockImplementation((work) => work(TRANSACTION));
  plans.view.mockResolvedValue(plan());
  plans.run.mockResolvedValue(run());
  plans.controlRun.mockResolvedValue(run({ status: "stopping" }));
  world.readControl.mockResolvedValue(CONTROL);
}

/**
 * The stored acknowledgement of a run command.
 *
 * @param status - Its delivery state.
 * @returns The receipt as it is stored.
 */
export function receipt(status: string): Record<string, unknown> {
  return {
    id: "command-1",
    runId: "run-1",
    action: "pause",
    status,
    acceptedAt: "2026-01-01T00:00:00.000Z",
  };
}
