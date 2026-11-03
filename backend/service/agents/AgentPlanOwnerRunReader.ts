import { isPlanFlowNode } from "@/definition/AgentPlanGraph";
import { planFlowSequence } from "@/definition/AgentPlanSequence";

import { isPlanHistoryReadFailure } from "./AgentPlanControlAccess";
import { readAuthorizedPlanRun } from "./AgentPlanRunReader";
import { readPlanSnapshot } from "./AgentPlanSnapshot";

import type { AgentPlan, AgentPlanRun } from "@/definition/AgentPlan";
import type { PlanDependencies } from "./AgentPlanService";

/** The flow of the plan revision a run executes, reduced to what notifications need. */
export interface AgentPlanRunFlow {
  /** Position of a flow node along the flow, Start counts as one; `null` without a number. */
  numberOf(nodeId: string): number | null;
  /**
   * Whether an identifier names a step of the executed plan.
   *
   * @remarks
   * Start and End are no steps, and neither is a row the run view derives,
   * such as the summary of a group, which names no node of the plan.
   */
  isStep(nodeId: string): boolean;
  /** Whether Start alone leads into the node, so it begins the run. */
  isEntry(nodeId: string): boolean;
}

/**
 * What the owner of a plan may do with a run right now.
 *
 * @remarks
 * `gone` means no run of the account with this identifier exists any more;
 * `denied` that it exists but the account no longer owns the plan or may no
 * longer read everything the run used. Neither carries a name.
 */
export type AgentPlanOwnerRunAccess =
  | {
      readonly status: "granted";
      /** The authorized view of the run, step names included. */
      readonly run: AgentPlanRun;
      readonly plan: { readonly id: string; readonly name: string };
      readonly flow: AgentPlanRunFlow;
    }
  | { readonly status: "gone" }
  | { readonly status: "denied" };

function describeFlow(plan: AgentPlan): AgentPlanRunFlow {
  const numbers = new Map(
    planFlowSequence(plan).order.map((id, index) => [id, index + 1]),
  );
  const nodes = new Map(plan.nodes.map((node) => [node.id, node]));
  const sources = new Map<string, string[]>();

  for (const edge of plan.edges) {
    const source = nodes.get(edge.from);
    const target = nodes.get(edge.to);

    if (
      source !== undefined &&
      target !== undefined &&
      isPlanFlowNode(source) &&
      isPlanFlowNode(target)
    ) {
      sources.set(edge.to, [...(sources.get(edge.to) ?? []), source.type]);
    }
  }

  return {
    numberOf: (nodeId) => numbers.get(nodeId) ?? null,
    isStep: (nodeId) => {
      const node = nodes.get(nodeId);

      return (
        node !== undefined &&
        isPlanFlowNode(node) &&
        node.type !== "start" &&
        node.type !== "end" &&
        node.type !== "decision" &&
        node.type !== "stack"
      );
    },
    isEntry: (nodeId) => {
      const incoming = sources.get(nodeId) ?? [];

      return incoming.length > 0 && incoming.every((type) => type === "start");
    },
  };
}

/**
 * Reads a run for the owner of its plan, with every right checked again.
 *
 * @remarks
 * Notifications go only to the account that owns the plan and may read the
 * concrete run. The run is read through the same checks as opening it on the
 * plan page, so an account that lost access to the plan, its workspace, its
 * model or any ticket or page the run used gets nothing, not even a name.
 */
export class AgentPlanOwnerRunReader {
  private readonly dependencies: PlanDependencies;

  /**
   * Creates the reader.
   *
   * @param dependencies - Run storage and the checks every read of a run needs.
   */
  public constructor(dependencies: PlanDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Reads a run for an account.
   *
   * @param accountId - The account that asks.
   * @param runId - The run.
   * @returns The run when the account owns the plan, started the run and may
   * read it now; otherwise why not.
   * @throws When Pages cannot decide right now, for example on a storage
   * failure; the caller must not treat that as a refusal.
   */
  public async read(
    accountId: string,
    runId: string,
  ): Promise<AgentPlanOwnerRunAccess> {
    const stored = await this.dependencies.runs.find(runId);

    if (stored === null || stored.userId !== accountId) {
      return { status: "gone" };
    }

    try {
      return await this.readAuthorized(accountId, runId);
    } catch (error: unknown) {
      if (isPlanHistoryReadFailure(error)) {
        return { status: "denied" };
      }

      throw error;
    }
  }

  private async readAuthorized(
    accountId: string,
    runId: string,
  ): Promise<AgentPlanOwnerRunAccess> {
    const run = await readAuthorizedPlanRun(
      this.dependencies,
      accountId,
      runId,
    );
    const plan = await this.dependencies.access.require(accountId, run.planId);

    if (plan.ownerId !== accountId) {
      return { status: "denied" };
    }

    const snapshot = readPlanSnapshot(
      await this.dependencies.runs.snapshot(runId),
    );

    return {
      status: "granted",
      run,
      plan: { id: plan.id, name: plan.name },
      flow: describeFlow(snapshot.plan),
    };
  }
}
