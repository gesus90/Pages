import { AgentOperationError } from "@/backend/error/AgentOperationError";
import {
  WikiPageNotFoundError,
  WikiValidationError,
} from "@/backend/error/WikiErrors";

import { AgentWikiCreateTransaction } from "./AgentWikiCreateTransaction";

import type { AgentChannel } from "@/backend/auth/McpActorContext";
import type { Database } from "@/backend/database/Database";
import type { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";
import type { WikiFileStore } from "@/backend/storage/WikiFileStore";
import type {
  AgentWikiCreateInput,
  AgentWikiCreated,
} from "@/definition/PagesAgentWrites";
import type { User } from "@/definition/User";

/** Dependencies share one connection and two server-owned storage directories. */
export interface AgentWikiCreateDependencies {
  readonly database: Database;
  readonly staging: WikiFileStore;
  readonly wikiFiles: WikiFileStore;
  readonly events: PagesEventPublisher;
  /** The agent surface the pages are created for; MCP when absent. */
  readonly channel?: AgentChannel;
}

/** Creates one project page and all attachment links in the same commit as its operation result. */
export class AgentWikiCreateService {
  private readonly dependencies: AgentWikiCreateDependencies;

  public constructor(dependencies: AgentWikiCreateDependencies) {
    this.dependencies = dependencies;
  }

  /** Serializes competing creates; matching replays return the committed result without new objects or events. */
  public async create(
    actor: User,
    input: AgentWikiCreateInput,
  ): Promise<AgentWikiCreated> {
    const creation = new AgentWikiCreateTransaction(this.dependencies);
    let result: AgentWikiCreated;
    try {
      result = await this.dependencies.database.transaction((transaction) =>
        creation.create(actor, input, transaction),
      );
    } catch (error: unknown) {
      await creation.rollback();
      if (error instanceof WikiPageNotFoundError)
        throw new AgentOperationError("NOT_FOUND");
      if (error instanceof WikiValidationError)
        throw new AgentOperationError("INVALID_REQUEST");
      throw error;
    }
    creation.publish();
    return result;
  }
}
