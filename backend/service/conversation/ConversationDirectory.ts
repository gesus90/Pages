import type { UserRepository } from "@/backend/database/repositories/UserRepository";
import type { WikiLookupRepository } from "@/backend/database/repositories/wiki/WikiLookupRepository";
import type { ConversationParticipant } from "@/definition/Conversation";
import type { User } from "@/definition/User";

/** What the directory reads. */
export interface ConversationDirectoryDependencies {
  readonly users: Pick<UserRepository, "findAll">;
  /** The active accounts, the same source as the participant dialog of the chat page. */
  readonly lookups: Pick<WikiLookupRepository, "listActiveUsers">;
  /** The job titles of agents by account. */
  readonly jobTitles: () => Promise<ReadonlyMap<string, string | null>>;
}

/** One account as conversations know it. */
export interface ConversationAccount {
  readonly user: User;
  readonly participant: ConversationParticipant;
  /** The job title of an agent; empty for a person. */
  readonly role: string;
  /** Whether the account can be added to a conversation and written to now. */
  readonly isAvailable: boolean;
}

/** Every account of one reading, by ID. */
export class ConversationAccounts {
  private readonly accounts: ReadonlyMap<string, ConversationAccount>;

  /**
   * Wraps one reading of the accounts.
   *
   * @param accounts - The accounts by ID.
   */
  public constructor(accounts: ReadonlyMap<string, ConversationAccount>) {
    this.accounts = accounts;
  }

  /** Returns an account, or `undefined` for an unknown ID. */
  public find(id: string): ConversationAccount | undefined {
    return this.accounts.get(id);
  }

  /**
   * Returns the participant of an account, with a neutral stand-in for an
   * account that no longer exists.
   */
  public participant(id: string): ConversationParticipant {
    return (
      this.accounts.get(id)?.participant ?? {
        id,
        kind: "human",
        name: "—",
        color: null,
      }
    );
  }

  /** Returns every account others can add now, without the given one. */
  public available(exceptId: string): ConversationAccount[] {
    return [...this.accounts.values()].filter(
      (account) => account.isAvailable && account.user.id !== exceptId,
    );
  }
}

/**
 * Reads the people and agents conversations name and choose from (PAGE-278).
 *
 * @remarks
 * The rules are those of the participant dialog of the chat page: only
 * active accounts can be chosen, agents included; a deactivated account keeps
 * its name in the conversations it belongs to.
 */
export class ConversationDirectory {
  private readonly dependencies: ConversationDirectoryDependencies;

  public constructor(dependencies: ConversationDirectoryDependencies) {
    this.dependencies = dependencies;
  }

  /** Reads every account once. */
  public async read(): Promise<ConversationAccounts> {
    const [users, active, titles] = await Promise.all([
      this.dependencies.users.findAll(),
      this.dependencies.lookups.listActiveUsers(),
      this.dependencies.jobTitles(),
    ]);
    const activeIds = new Set(active.map((user) => user.id));
    return new ConversationAccounts(
      new Map(
        users.map((user): [string, ConversationAccount] => [
          user.id,
          {
            user,
            participant: {
              id: user.id,
              kind: user.isAgent === true ? "agent" : "human",
              name: user.displayName,
              color: user.avatarColor ?? null,
            },
            role: titles.get(user.id) ?? "",
            isAvailable: user.isActive && activeIds.has(user.id),
          },
        ]),
      ),
    );
  }
}
