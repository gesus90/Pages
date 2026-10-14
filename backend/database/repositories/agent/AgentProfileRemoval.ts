import { readPlanInput } from "@/backend/agents/AgentPlanInput";
import {
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { AgentError } from "@/backend/error/AgentErrors";

import type { DatabaseTransaction } from "@/backend/database/Database";

/** Clears live references and removes an administrator profile in the caller's transaction. */
export class AgentProfileRemoval {
  private readonly database: DatabaseTransaction;

  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /** Retains dependent agents, plans and historical runs; revisions invalidate stale editors. */
  public async remove(id: string): Promise<void> {
    const [profile] = await this.database.query(
      `
      SELECT owner_id
      FROM agent_execution_profiles
      WHERE id = $id;
      `,
      { id },
    );
    if (!profile) throw new AgentError("profile_not_found");
    if (readNullableTextColumn(profile, 0, "owner_id") !== null)
      throw new AgentError("agent_usage_denied");
    await this.clearPlans(id);
    await this.database.execute(
      `
      UPDATE agent_execution_profiles
      SET model_profile_id = NULL,
          revision = revision + 1
      WHERE model_profile_id = $id;
      `,
      { id },
    );
    await this.database.execute(
      "DELETE FROM agent_legacy_function_assignments WHERE profile_id = $id;",
      { id },
    );
    await this.database.execute(
      "DELETE FROM agent_profile_targets WHERE profile_id = $id;",
      { id },
    );
    await this.database.execute(
      "DELETE FROM agent_profile_purposes WHERE profile_id = $id;",
      { id },
    );
    await this.database.execute(
      "DELETE FROM agent_execution_profiles WHERE id = $id;",
      { id },
    );
  }

  private async clearPlans(id: string): Promise<void> {
    const rows = await this.database.query(
      `
      SELECT DISTINCT
          plans.id,
          plans.plan_json
      FROM agent_plans AS plans,
          json_each(json_extract(plans.plan_json, '$.nodes')) AS node
      WHERE json_extract_string(node.value, '$.type') = 'agent'
          AND (
              json_extract_string(node.value, '$.agentId') = $id
              OR json_extract_string(node.value, '$.personalAgentId') = $id
          );
      `,
      { id },
    );
    for (const row of rows) {
      const plan = readPlanInput(
        JSON.parse(readTextColumn(row, 1, "plan_json")),
      );
      const nodes = plan.nodes.map((node) => {
        if (node.type !== "agent") return node;
        return {
          ...node,
          agentId: node.agentId === id ? "" : node.agentId,
          // null chooses an automatic grant; an emptied explicit grant must remain blocked.
          personalAgentId:
            node.personalAgentId === id ? "" : node.personalAgentId,
        };
      });
      await this.database.execute(
        `
        UPDATE agent_plans
        SET plan_json = $plan_json,
            revision = revision + 1
        WHERE id = $id;
        `,
        {
          id: readTextColumn(row, 0, "id"),
          plan_json: JSON.stringify({ ...plan, nodes }),
        },
      );
    }
  }
}
