import { isPlanFlowNode } from "@/definition/AgentPlanGraph";
import { planFlowSequence } from "@/definition/AgentPlanSequence";

import { allRunAssetReferences } from "@/backend/agents/AgentPlanRunResources";

import { isPlanHistoryReadFailure } from "./AgentPlanControlAccess";
import {
  readAuthorizedPlanRun,
  requirePlanRunResourceAccess,
} from "./AgentPlanRunReader";
import { readPlanSnapshot } from "./AgentPlanSnapshot";

import type { AgentPlan, AgentPlanRun } from "@/definition/AgentPlan";
import type { PlanRunReadDependencies } from "./AgentPlanRunReader";

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
 * Why an account may follow a run.
 *
 * @remarks
 * `starter`: the account started the run, whoever owns the plan. `team`: the
 * account is a member or leader of the department the plan belongs to now and
 * may read the plan and everything the run used itself.
 */
export type AgentPlanRunRelation = "starter" | "team";

/**
 * What an account may do with a run right now.
 *
 * @remarks
 * `gone` means no run with this identifier exists any more; `denied` that it
 * exists but the account neither started it nor belongs to the team of its
 * plan, or may no longer read the plan or everything the run used. Neither
 * carries a name.
 */
export type AgentPlanOwnerRunAccess =
  | {
      readonly status: "granted";
      readonly relation: AgentPlanRunRelation;
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
 * Reads a run for the account that follows it, with every right checked again.
 *
 * @remarks
 * The starter of a run reads it through the same checks as opening it on the
 * plan page, whoever owns the plan. Another account reads it only as a current
 * member or leader of the plan's team, and only when it may read the plan and
 * every model, workspace, ticket, page and file the run used itself; belonging
 * to the team never stands in for one of those rights. An account that lost
 * access gets nothing, not even a name.
 */
export class AgentPlanOwnerRunReader {
  private readonly dependencies: PlanRunReadDependencies;

  /**
   * Creates the reader.
   *
   * @param dependencies - Run storage and the checks every read of a run needs.
   */
  public constructor(dependencies: PlanRunReadDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Reads a run for an account.
   *
   * @param accountId - The account that asks.
   * @param runId - The run.
   * @returns The run when the account started it or belongs to the team of its
   * plan and may read it now; otherwise why not.
   * @throws When Pages cannot decide right now, for example on a storage
   * failure; the caller must not treat that as a refusal.
   */
  public async read(
    accountId: string,
    runId: string,
  ): Promise<AgentPlanOwnerRunAccess> {
    const stored = await this.dependencies.runs.find(runId);

    if (stored === null) {
      return { status: "gone" };
    }

    try {
      return stored.userId === accountId
        ? await this.readAsStarter(accountId, runId)
        : await this.readAsTeamMember(accountId, stored);
    } catch (error: unknown) {
      if (isPlanHistoryReadFailure(error)) {
        return { status: "denied" };
      }

      throw error;
    }
  }

  private async readAsStarter(
    accountId: string,
    runId: string,
  ): Promise<AgentPlanOwnerRunAccess> {
    const run = await readAuthorizedPlanRun(
      this.dependencies,
      accountId,
      runId,
    );
    const plan = await this.dependencies.access.require(accountId, run.planId);

    return this.grant("starter", run, plan);
  }

  /** The stored view of the run: team members get names and states, never the progress of the starter's tickets. */
  private async readAsTeamMember(
    accountId: string,
    stored: AgentPlanRun,
  ): Promise<AgentPlanOwnerRunAccess> {
    const { access, runs } = this.dependencies;
    const plan = await access.require(accountId, stored.planId);
    const team = await access.team(accountId, null);

    if (
      plan.departmentId === undefined ||
      plan.departmentId === null ||
      !team.departmentIds.includes(plan.departmentId)
    ) {
      return { status: "denied" };
    }

    const resources = await runs.resources(stored.id);

    await requirePlanRunResourceAccess(this.dependencies, accountId, {
      resources,
      ticketAssets: allRunAssetReferences(stored, resources.ticketAssets),
    });

    return this.grant("team", stored, plan);
  }

  private async grant(
    relation: AgentPlanRunRelation,
    run: AgentPlanRun,
    plan: Pick<AgentPlan, "id" | "name">,
  ): Promise<AgentPlanOwnerRunAccess> {
    const snapshot = readPlanSnapshot(
      await this.dependencies.runs.snapshot(run.id),
    );

    return {
      status: "granted",
      relation,
      run,
      plan: { id: plan.id, name: plan.name },
      flow: describeFlow(snapshot.plan),
    };
  }
}
