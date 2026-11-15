import type { StoredPlanBridgeGrant } from "@/backend/database/repositories/agent/PlanBridgeGrantRepository";
import type { PlanBridgeGrantStore } from "@/backend/service/agents/bridge/PlanBridgeGrants";

/** A grant store that stands in for the table and outlives a registry, as the database outlives the API process. */
export class MemoryPlanBridgeGrantStore implements PlanBridgeGrantStore {
  public readonly rows = new Map<string, StoredPlanBridgeGrant>();

  /** Saves a row. */
  public async insert(grant: StoredPlanBridgeGrant): Promise<void> {
    this.rows.set(grant.bearerHash, grant);
  }

  /** Finds the row of a bearer hash. */
  public async find(bearerHash: string): Promise<StoredPlanBridgeGrant | null> {
    return this.rows.get(bearerHash) ?? null;
  }

  /** Removes the row of a bearer hash. */
  public async delete(bearerHash: string): Promise<void> {
    this.rows.delete(bearerHash);
  }

  /** Removes the rows of one step or of a whole run. */
  public async revoke(runId: string, stepId: string | null): Promise<void> {
    for (const [key, row] of this.rows) {
      if (row.runId !== runId) continue;
      if (stepId !== null && row.stepId !== stepId) continue;
      this.rows.delete(key);
    }
  }
}
