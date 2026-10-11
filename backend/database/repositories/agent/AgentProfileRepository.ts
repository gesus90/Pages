import { AgentProfileStore } from "./AgentProfileStore";

import type { Database } from "@/backend/database/Database";
import type { AgentProfile } from "@/definition/AgentProfile";
import type { AgentUsage } from "@/definition/AgentUsage";

/** Atomic execution-profile persistence, independent of credential storage. */
export class AgentProfileRepository {
  private readonly database: Database;

  public constructor(database: Database) {
    this.database = database;
  }

  /** Reads profiles and all their scopes from one coherent snapshot. */
  public async list(): Promise<readonly AgentProfile[]> {
    return this.database.transaction((transaction) =>
      new AgentProfileStore(transaction).list(),
    );
  }

  /** Commits configuration and scope replacement together. */
  public async save(profile: AgentProfile): Promise<void> {
    await this.database.transaction((transaction) =>
      new AgentProfileStore(transaction).save(profile),
    );
  }

  /** Removes configuration and grants in the same transaction. */
  public async remove(id: string): Promise<void> {
    await this.database.transaction((transaction) =>
      new AgentProfileStore(transaction).remove(id),
    );
  }

  /** Supplies the current references for the administration deletion dialog. */
  public async usages(id: string): Promise<readonly AgentUsage[]> {
    return this.database.transaction((transaction) =>
      new AgentProfileStore(transaction).usages(id),
    );
  }
}
