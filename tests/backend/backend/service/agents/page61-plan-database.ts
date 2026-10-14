import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
  SqlParameters,
} from "@/backend/database/Database";
import type { AgentPlan } from "@/definition/AgentPlan";

interface StoredPlan {
  readonly id: string;
  readonly ownerId: string;
  readonly projectId: string;
  readonly name: string;
  revision: number;
  planJson: string;
}

interface StoredRun {
  readonly planId: string;
  readonly status: string;
}

function parameter(parameters: SqlParameters, name: string): string {
  const value = parameters[name];
  if (typeof value !== "string") throw new Error(`Missing ${name}`);
  return value;
}

/**
 * The plan, run, workspace and agent tables as the plan repository reads them.
 *
 * @remarks
 * Statements are recognised by their table and clause; no SQL engine or file
 * is used. A failing transaction restores the stored rows.
 */
export class PlanDatabase {
  public plans: StoredPlan[] = [];
  public runs: StoredRun[] = [];
  public readonly workspaces = new Map([["workspace", "project"]]);
  public readonly agents = new Set(["agent"]);

  /** Stores a plan row as a previous save would have left it. */
  public insert(plan: AgentPlan): void {
    this.plans.push({
      id: plan.id,
      ownerId: plan.ownerId,
      projectId: plan.projectId,
      name: plan.name,
      revision: plan.revision,
      planJson: JSON.stringify(plan),
    });
  }

  /** Query and transaction access for the repository under test. */
  public asDatabase(): Pick<Database, "transaction" | "query"> {
    return {
      query: async (statement, parameters = {}) =>
        this.query(statement, parameters),
      transaction: async (work) => {
        const before = structuredClone({ plans: this.plans, runs: this.runs });
        const transaction: DatabaseTransaction = {
          query: async (statement, parameters = {}) =>
            this.query(statement, parameters),
          execute: async (statement, parameters = {}) => {
            this.execute(statement, parameters);
          },
        };
        try {
          return await work(transaction);
        } catch (error: unknown) {
          this.plans = before.plans;
          this.runs = before.runs;
          throw error;
        }
      },
    };
  }

  private query(
    statement: string,
    parameters: SqlParameters,
  ): DatabaseValue[][] {
    if (statement.includes("FROM agent_plan_runs"))
      return this.runs
        .filter(
          (run) =>
            run.planId === parameter(parameters, "plan_id") &&
            (run.status === "running" || run.status === "paused"),
        )
        .map((run) => [run.planId]);
    if (statement.includes("FROM agent_workspaces")) {
      const project = this.workspaces.get(parameter(parameters, "id"));
      return project === undefined ? [] : [[project]];
    }
    if (statement.includes("FROM agent_execution_profiles"))
      return this.agents.has(parameter(parameters, "id"))
        ? [[parameter(parameters, "id")]]
        : [];
    if (statement.includes("FROM agent_plans"))
      return this.plans
        .filter(
          (plan) =>
            !statement.includes("WHERE id = $id") ||
            plan.id === parameter(parameters, "id"),
        )
        .toSorted((first, second) =>
          first.name.toLowerCase().localeCompare(second.name.toLowerCase()),
        )
        .map((plan) => [
          plan.id,
          plan.ownerId,
          plan.projectId,
          plan.revision,
          plan.planJson,
        ]);
    throw new Error(`Unexpected query: ${statement}`);
  }

  private execute(statement: string, parameters: SqlParameters): void {
    if (statement.includes("DELETE FROM agent_plans")) {
      this.plans = this.plans.filter(
        (plan) => plan.id !== parameter(parameters, "id"),
      );
      return;
    }
    if (!statement.includes("INSERT INTO agent_plans"))
      throw new Error(`Unexpected statement: ${statement}`);
    const id = parameter(parameters, "id");
    const previous = this.plans.find((plan) => plan.id === id);
    if (previous) {
      previous.revision += 1;
      previous.planJson = parameter(parameters, "plan_json");
      return;
    }
    this.plans.push({
      id,
      ownerId: parameter(parameters, "owner_id"),
      projectId: parameter(parameters, "project_id"),
      name: parameter(parameters, "name"),
      revision: 1,
      planJson: parameter(parameters, "plan_json"),
    });
  }
}
