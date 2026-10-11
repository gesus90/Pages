import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";

import type { McpOAuthRepository } from "@/backend/database/repositories/mcp/McpOAuthRepository";
import type { OAuthGrant } from "@/backend/database/repositories/mcp/OAuthGrantRepository";

/** Manages the owner's consent summaries and re-verification preference through the API. */
export class OAuthGrantService {
  private readonly repository: McpOAuthRepository;

  public constructor(repository: McpOAuthRepository) {
    this.repository = repository;
  }

  /** Returns the stored duration and owner-scoped grants, with expiry reconciled. */
  public async get(userId: string): Promise<{
    readonly durationSeconds: number | null;
    readonly grants: readonly OAuthGrant[];
  }> {
    return this.repository.transaction(async (repository) => {
      const durationSeconds = await repository.grants().duration(userId);
      await repository
        .grants()
        .setDuration(userId, durationSeconds, Date.now());
      const ids = await repository.grants().listIds(userId);
      const grants: OAuthGrant[] = [];
      for (const id of ids) {
        const grant = await repository.grants().find(id);
        if (grant) grants.push(grant);
      }
      return { durationSeconds, grants };
    });
  }

  /** Applies a positive duration or unlimited to all still-active consents, atomically. */
  public async setDuration(userId: string, duration: unknown): Promise<void> {
    if (
      duration !== null &&
      (typeof duration !== "number" ||
        !Number.isSafeInteger(duration) ||
        duration < 1 ||
        duration > 315_576_000)
    ) {
      throw new McpAuthorizationError("invalid_request");
    }
    await this.repository.transaction((repository) =>
      repository.grants().setDuration(userId, duration, Date.now()),
    );
  }

  /** Revokes a grant only when it belongs to the requesting browser user. */
  public async revoke(userId: string, id: string): Promise<void> {
    await this.repository.transaction(async (repository) => {
      const grant = await repository.grants().find(id);
      if (!grant || grant.userId !== userId)
        throw new McpAuthorizationError("access_denied", 403);
      await repository.grants().end(id, "revoked", Date.now());
    });
  }
}
