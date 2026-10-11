import { OAuthClientRepository } from "./OAuthClientRepository";
import { OAuthCredentialRepository } from "./OAuthCredentialRepository";
import { OAuthFlowRepository } from "./OAuthFlowRepository";
import { OAuthGrantRepository } from "./OAuthGrantRepository";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";

/** Coordinates atomic OAuth state changes without mixing persistence with policy. */
export class McpOAuthRepository {
  private readonly database: Pick<
    Database,
    "query" | "execute" | "transaction"
  >;

  public constructor(
    database: Pick<Database, "query" | "execute" | "transaction">,
  ) {
    this.database = database;
  }

  /** Runs consent, exchange, refresh and preference changes without interleaving. */
  public async transaction<Result>(
    work: (repository: McpOAuthRepository) => Promise<Result>,
  ): Promise<Result> {
    return this.database.transaction((scope) =>
      work(
        new McpOAuthRepository({
          ...scope,
          transaction: async <Nested>(
            operation: (transaction: DatabaseTransaction) => Promise<Nested>,
          ): Promise<Nested> => operation(scope),
        }),
      ),
    );
  }

  /** Client registration persistence in the current transaction. */
  public clients(): OAuthClientRepository {
    return new OAuthClientRepository(this.database);
  }
  /** Browser consent persistence in the current transaction. */
  public flows(): OAuthFlowRepository {
    return new OAuthFlowRepository(this.database);
  }
  /** Grant and user-preference persistence in the current transaction. */
  public grants(): OAuthGrantRepository {
    return new OAuthGrantRepository(this.database);
  }
  /** Credential hash persistence in the current transaction. */
  public credentials(): OAuthCredentialRepository {
    return new OAuthCredentialRepository(this.database);
  }
}
