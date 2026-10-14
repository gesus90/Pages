import { readPlanInput } from "@/backend/agents/AgentPlanInput";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
  SqlParameters,
} from "@/backend/database/Database";
import type { AgentPlanInput } from "@/definition/AgentPlan";

interface StoredProfile {
  readonly id: string;
  readonly ownerId: string | null;
  modelProfileId: string | null;
  revision: number;
}

interface StoredPlan {
  readonly id: string;
  input: AgentPlanInput;
  revision: number;
}

/** Synthetic relationships including independent records that must survive deletion. */
export class RemovalDatabase {
  public profiles: StoredProfile[] = [
    { id: "removed", ownerId: null, modelProfileId: null, revision: 1 },
    { id: "other", ownerId: null, modelProfileId: null, revision: 1 },
  ];
  public plans: StoredPlan[] = [];
  public scopes = ["removed", "other"];
  public purposes = ["removed", "other"];
  public legacy = ["removed", "other"];
  public readonly retained = {
    users: ["owner"],
    groups: ["group"],
    departments: ["department"],
    connections: ["connection"],
    projects: ["project"],
    tickets: ["ticket"],
    workspaces: ["workspace"],
    runs: [{ agentId: "removed", output: "Historical result" }],
  };
  public commits = 0;
  public rollbacks = 0;
  public failureAt = 0;
  public executions = 0;

  /** Adds both kinds of plan reference and a user agent pointing to the removed model. */
  public link(index: number): void {
    this.profiles.push({
      id: `user-${index}`,
      ownerId: "owner",
      modelProfileId: "removed",
      revision: 3,
    });
    this.plans.push({
      id: `plan-${index}`,
      revision: 4,
      input: {
        name: "Synthetic plan",
        workspaceId: "workspace",
        projectId: "project",
        usage: "private",
        globals: {},
        nodes: [
          {
            id: "step",
            type: "agent",
            x: 20,
            y: 40,
            agentId: "removed",
            personalAgentId: "removed",
            instruction: "Keep this",
            bindings: { ticket: { kind: "source", nodeId: "task" } },
          },
          { id: "task", type: "task", x: 0, y: 0, taskId: "ticket" },
          {
            id: "other",
            type: "agent",
            x: 40,
            y: 80,
            agentId: "other",
            personalAgentId: null,
            instruction: "Unrelated",
            bindings: {},
          },
        ],
        edges: [
          {
            from: "step",
            to: "other",
            fromPort: "flow-out",
            toPort: "flow-in",
          },
        ],
      },
    });
  }

  /** Transaction contract with rollback; no SQL engine or filesystem is used. */
  public asDatabase(): Pick<Database, "transaction"> {
    return {
      transaction: async (work) => {
        const before = structuredClone({
          profiles: this.profiles,
          plans: this.plans,
          scopes: this.scopes,
          purposes: this.purposes,
          legacy: this.legacy,
        });
        const transaction: DatabaseTransaction = {
          query: (statement, parameters = {}) =>
            this.query(statement, parameters),
          execute: (statement, parameters = {}) =>
            this.execute(statement, parameters),
        };
        try {
          const result = await work(transaction);
          this.commits += 1;
          return result;
        } catch (error: unknown) {
          Object.assign(this, before);
          this.rollbacks += 1;
          throw error;
        }
      },
    };
  }

  private async query(
    statement: string,
    parameters: SqlParameters,
  ): Promise<DatabaseValue[][]> {
    if (statement.includes("SELECT owner_id")) {
      const profile = this.profiles.find((entry) => entry.id === parameters.id);
      return profile ? [[profile.ownerId]] : [];
    }
    if (statement.includes("FROM agent_plans"))
      return this.plans
        .filter((plan) =>
          plan.input.nodes.some(
            (node) =>
              node.type === "agent" &&
              (node.agentId === parameters.id ||
                node.personalAgentId === parameters.id),
          ),
        )
        .map((plan) => [plan.id, JSON.stringify(plan.input)]);
    if (statement.includes("FROM agent_execution_profiles"))
      return this.profiles.map((profile) => [
        profile.id,
        profile.id,
        "connection",
        "model",
        null,
        1,
        JSON.stringify(emptyAgentConfiguration()),
        profile.revision,
        profile.ownerId,
        profile.modelProfileId,
      ]);
    if (statement.includes("FROM agent_profile_purposes"))
      return this.profiles.map((profile) => [profile.id, "agent"]);
    if (statement.includes("FROM agent_profile_targets")) return [];
    throw new Error(`Unexpected query: ${statement}`);
  }

  private async execute(
    statement: string,
    parameters: SqlParameters,
  ): Promise<void> {
    this.executions += 1;
    if (this.executions === this.failureAt)
      throw new Error("Synthetic write failure");
    if (statement.includes("UPDATE agent_plans")) {
      const plan = this.plans.find((entry) => entry.id === parameters.id);
      if (!plan || typeof parameters.plan_json !== "string")
        throw new Error("Missing plan");
      plan.input = readPlanInput(JSON.parse(parameters.plan_json));
      plan.revision += 1;
    } else if (statement.includes("SET model_profile_id = NULL")) {
      for (const profile of this.profiles.filter(
        (entry) => entry.modelProfileId === parameters.id,
      )) {
        profile.modelProfileId = null;
        profile.revision += 1;
      }
    } else if (
      statement.includes("DELETE FROM agent_legacy_function_assignments")
    )
      this.legacy = this.legacy.filter((id) => id !== parameters.id);
    else if (statement.includes("DELETE FROM agent_profile_targets"))
      this.scopes = this.scopes.filter((id) => id !== parameters.id);
    else if (statement.includes("DELETE FROM agent_profile_purposes"))
      this.purposes = this.purposes.filter((id) => id !== parameters.id);
    else if (statement.includes("DELETE FROM agent_execution_profiles"))
      this.profiles = this.profiles.filter(
        (profile) => profile.id !== parameters.id,
      );
    else throw new Error(`Unexpected statement: ${statement}`);
  }
}
