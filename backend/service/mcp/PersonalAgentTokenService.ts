import { randomUUID } from "node:crypto";

import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import {
  createAgentCredential,
  hashAgentCredential,
} from "@/backend/security/AgentCredential";

import type {
  PersonalAgentTokenRepository,
  StoredPersonalToken,
} from "@/backend/database/repositories/mcp/PersonalAgentTokenRepository";
import type { AgentIdentityService } from "./AgentIdentityService";
import type {
  AgentIdentity,
  PersonalAgentToken,
} from "@/definition/McpAuthorization";

/** Manages personal stdio credentials; only creation and rotation return clear text once. */
export class PersonalAgentTokenService {
  private readonly repository: PersonalAgentTokenRepository;
  private readonly identities: AgentIdentityService;

  public constructor(
    repository: PersonalAgentTokenRepository,
    identities: AgentIdentityService,
  ) {
    this.repository = repository;
    this.identities = identities;
  }

  /** Creates a named owner-bound credential with an optional absolute expiry. */
  public async create(
    userId: string,
    name: unknown,
    expiresAt: unknown,
  ): Promise<{ readonly token: string; readonly summary: PersonalAgentToken }> {
    await this.identities.verify(userId);
    return this.issue(userId, name, expiresAt);
  }

  /** Returns only the owner's audit summaries, never hashes or clear text. */
  public async list(userId: string): Promise<PersonalAgentToken[]> {
    return (await this.repository.list(userId)).map((token) => ({
      ...token,
      status: status(token),
    }));
  }

  /** Revokes a token belonging to the requesting user. */
  public async revoke(userId: string, id: string): Promise<void> {
    await this.repository.revoke(userId, id, Date.now());
  }

  /** Atomically replaces an active token, retaining its original expiry and audit record. */
  public async rotate(
    userId: string,
    id: string,
  ): Promise<{ readonly token: string; readonly summary: PersonalAgentToken }> {
    await this.identities.verify(userId);
    return this.repository.transaction(async (repository) => {
      const previous = (await repository.list(userId)).find(
        (token) => token.id === id,
      );
      if (!previous || status(previous) !== "active")
        throw new McpAuthorizationError("invalid_request");
      await repository.revoke(userId, id, Date.now());
      return new PersonalAgentTokenService(repository, this.identities).issue(
        userId,
        previous.name,
        previous.expiresAt,
      );
    });
  }

  /** Resolves identity and rights anew; expired, revoked and unknown credentials fail closed. */
  public async verify(token: string): Promise<AgentIdentity> {
    const owner = await this.repository.findOwner(
      hashAgentCredential(token),
      Date.now(),
    );
    if (!owner) throw new McpAuthorizationError("invalid_token", 401);
    return this.identities.verify(owner);
  }
  private async issue(
    userId: string,
    name: unknown,
    expiresAt: unknown,
  ): Promise<{ readonly token: string; readonly summary: PersonalAgentToken }> {
    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.trim().length > 100 ||
      (expiresAt !== null &&
        (typeof expiresAt !== "number" ||
          !Number.isSafeInteger(expiresAt) ||
          expiresAt <= Date.now()))
    ) {
      throw new McpAuthorizationError("invalid_request");
    }
    const token = createAgentCredential();
    const summary: PersonalAgentToken = {
      id: randomUUID(),
      userId,
      name: name.trim(),
      createdAt: Date.now(),
      expiresAt,
      revokedAt: null,
      status: "active",
    };
    await this.repository.insert(summary, hashAgentCredential(token));
    return { token, summary };
  }
}

function status(token: StoredPersonalToken): PersonalAgentToken["status"] {
  if (token.revokedAt !== null) return "revoked";
  return token.expiresAt !== null && token.expiresAt <= Date.now()
    ? "expired"
    : "active";
}
