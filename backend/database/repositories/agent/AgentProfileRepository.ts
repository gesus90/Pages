import { AgentProfileStore } from "./AgentProfileStore";
import { AgentProfileRemoval } from "./AgentProfileRemoval";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { AgentProfile } from "@/definition/AgentProfile";
import type { AgentUsage } from "@/definition/AgentUsage";

/**
 * Work that commits together with a saved profile.
 *
 * @remarks
 * It runs after the profile was written, in the same transaction: when it
 * throws, the profile is not saved. The profile is passed as it was saved, so
 * its revision is the one that was checked, not the new one.
 */
export type AgentProfileJournal = (
  transaction: DatabaseTransaction,
  profile: AgentProfile,
) => Promise<void>;

/** Revision check and work that must commit atomically with a removal. */
export interface AgentProfileRemoveOptions {
  readonly expectedRevision?: number;
  readonly journal?: (transaction: DatabaseTransaction) => Promise<void>;
}

/** Atomic execution-profile persistence, independent of credential storage. */
export class AgentProfileRepository {
  private readonly database: Pick<Database, "transaction">;

  public constructor(database: Pick<Database, "transaction">) {
    this.database = database;
  }

  /** Reads profiles and all their scopes from one coherent snapshot. */
  public async list(): Promise<readonly AgentProfile[]> {
    return this.database.transaction((transaction) =>
      new AgentProfileStore(transaction).list(),
    );
  }

  /** Commits configuration and scope replacement together, and the journal with them. */
  public async save(
    profile: AgentProfile,
    journal?: AgentProfileJournal,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await new AgentProfileStore(transaction).save(profile);
      await journal?.(transaction, profile);
    });
  }

  /** Removes configuration and grants in the same transaction. */
  public async remove(
    id: string,
    options: AgentProfileRemoveOptions = {},
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await new AgentProfileStore(transaction).remove(
        id,
        options.expectedRevision,
      );
      await options.journal?.(transaction);
    });
  }

  /** Administrator deletion clears live references atomically without deleting dependent records. */
  public async removeWithReferences(id: string): Promise<void> {
    await this.database.transaction((transaction) =>
      new AgentProfileRemoval(transaction).remove(id),
    );
  }

  /** Supplies the current assignments and plan references. */
  public async usages(id: string): Promise<readonly AgentUsage[]> {
    return this.database.transaction((transaction) =>
      new AgentProfileStore(transaction).usages(id),
    );
  }
}
