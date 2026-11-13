import { AccountIdentityRepository } from "./AccountIdentityRepository";
import { AgentActivityRepository } from "./AgentActivityRepository";
import { AgentChatMemoryRepository } from "./AgentChatMemoryRepository";
import { AgentChatSessionRepository } from "./AgentChatSessionRepository";
import { AgentConversationRepository } from "./AgentConversationRepository";
import { AgentDeletionRepository } from "./AgentDeletionRepository";
import { AgentDeletionPurgeRepository } from "./AgentDeletionPurgeRepository";
import { AgentDreamingRepository } from "./AgentDreamingRepository";
import { AgentEmployeeRemovalRepository } from "./AgentEmployeeRemovalRepository";
import { AgentEmployeeRepository } from "./AgentEmployeeRepository";
import { AgentLearningSourceRepository } from "./AgentLearningSourceRepository";
import { AgentLogbookRepository } from "./AgentLogbookRepository";
import { AgentLogbookSessionRepository } from "./AgentLogbookSessionRepository";
import { AgentProfileLoadRepository } from "./AgentProfileLoadRepository";
import { AgentMemoryRepository } from "./AgentMemoryRepository";
import { AgentRecipeRepository } from "./AgentRecipeRepository";
import { AgentSessionSettingsRepository } from "./AgentSessionSettingsRepository";
import { AgentTemplateRepository } from "./AgentTemplateRepository";
import { AgentToolUseRepository } from "./AgentToolUseRepository";
import { ChatContactRepository } from "./ChatContactRepository";
import { ChatGroupRepository } from "./ChatGroupRepository";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";

/** SQL access usable directly or inside one open transaction. */
type EmployeeDatabase = Pick<Database, "query" | "execute" | "transaction">;

/** Binds every operation, nested transactions included, to one open transaction. */
function transactionScope(transaction: DatabaseTransaction): EmployeeDatabase {
  return {
    query: transaction.query.bind(transaction),
    execute: transaction.execute.bind(transaction),
    transaction: async (operation) => operation(transaction),
  };
}

/**
 * The repositories of agent employees and chat contacts (PAGE-266), on one
 * database or one open transaction.
 */
export class EmployeeStore {
  private readonly database: EmployeeDatabase;

  public constructor(database: EmployeeDatabase) {
    this.database = database;
  }

  /** Runs the work in one transaction; every repository of the given store shares it. */
  public async transaction<Result>(
    work: (store: EmployeeStore) => Promise<Result>,
  ): Promise<Result> {
    return this.database.transaction((transaction) =>
      work(new EmployeeStore(transactionScope(transaction))),
    );
  }

  /** Model, access, documents and learning state of agents. */
  public employees(): AgentEmployeeRepository {
    return new AgentEmployeeRepository(this.database);
  }

  /** The archive and the versions of the memory. */
  public memory(): AgentMemoryRepository {
    return new AgentMemoryRepository(this.database);
  }

  /** The templates of `AGENT.md` (PAGE-283). */
  public templates(): AgentTemplateRepository {
    return new AgentTemplateRepository(this.database);
  }

  /** Sessions, learning runs and changes of agents. */
  public activity(): AgentActivityRepository {
    return new AgentActivityRepository(this.database);
  }

  /** Account kind, job title and person color. */
  public identities(): AccountIdentityRepository {
    return new AccountIdentityRepository(this.database);
  }

  /** The chat sessions of agents with people. */
  public conversations(): AgentConversationRepository {
    return new AgentConversationRepository(this.database);
  }

  /** The state of the chat sessions of agents: inbox position, context and tokens (PAGE-376). */
  public chatSessions(): AgentChatSessionRepository {
    return new AgentChatSessionRepository(this.database);
  }

  /** The entries and settings of the Lagebuch of agents (PAGE-377). */
  public logbook(): AgentLogbookRepository {
    return new AgentLogbookRepository(this.database);
  }

  /** The schedule and the run state of the dream run of agents (PAGE-378). */
  public dreaming(): AgentDreamingRepository {
    return new AgentDreamingRepository(this.database);
  }

  /** The recipes of agents (PAGE-378). */
  public recipes(): AgentRecipeRepository {
    return new AgentRecipeRepository(this.database);
  }

  /** The tool calls of the chat sessions of agents, which the dream run reads (PAGE-378). */
  public toolUses(): AgentToolUseRepository {
    return new AgentToolUseRepository(this.database);
  }

  /** What the chat sessions remember of the Lagebuch: hint stand and summary progress (PAGE-377). */
  public logbookSessions(): AgentLogbookSessionRepository {
    return new AgentLogbookSessionRepository(this.database);
  }

  /** Summaries and confidentiality of chats for the memory (PAGE-305). */
  public chats(): AgentChatMemoryRepository {
    return new AgentChatMemoryRepository(this.database);
  }

  /** The session limits and the time of day of the dream run (PAGE-304, PAGE-305). */
  public sessionSettings(): AgentSessionSettingsRepository {
    return new AgentSessionSettingsRepository(this.database);
  }

  /** The participant lists of the chat. */
  public contacts(): ChatContactRepository {
    return new ChatContactRepository(this.database);
  }

  /** The groups of the chat (PAGE-259). */
  public groups(): ChatGroupRepository {
    return new ChatGroupRepository(this.database);
  }

  /** What refers to an agent, whether it works now, and its removal (PAGE-267). */
  public removals(): AgentEmployeeRemovalRepository {
    return new AgentEmployeeRemovalRepository(this.database);
  }

  /** Project roles, workload and last activity of agents (PAGE-308). */
  public profileLoads(): AgentProfileLoadRepository {
    return new AgentProfileLoadRepository(this.database);
  }

  /** Reversible agent deletion and its audit trail. */
  public deletions(): AgentDeletionRepository {
    return new AgentDeletionRepository(this.database);
  }

  /** Expiry and disk cleanup of deleted agents. */
  public deletionPurges(): AgentDeletionPurgeRepository {
    return new AgentDeletionPurgeRepository(this.database);
  }

  /** What is new for a learning run. */
  public sources(): AgentLearningSourceRepository {
    return new AgentLearningSourceRepository(this.database);
  }
}
