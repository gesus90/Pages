import { randomUUID } from "node:crypto";

import {
  createAgentCredential,
  hashAgentCredential,
} from "@/backend/security/AgentCredential";

import type { AgentRunCredentialRepository } from "@/backend/database/repositories/mcp/AgentRunCredentialRepository";
import type {
  AgentIdentity,
  AgentRunScope,
} from "@/definition/McpAuthorization";
import type { AgentIdentityService } from "./AgentIdentityService";

/** A credential issued to one session; the clear text exists only in memory. */
export interface IssuedRunCredential {
  readonly token: string;
  readonly expiresAt: number;
}

/**
 * Issues, verifies and ends the credentials of agent plan sessions.
 *
 * @remarks
 * A session reaches the agent API through the local MCP process with the
 * rights of its executor, narrowed to the operations and tickets of its node.
 * The credential lives only as long as the node, is stored as a hash and is
 * revoked when the node closes, whatever its outcome.
 */
export class AgentRunCredentialService {
  private readonly repository: AgentRunCredentialRepository;
  private readonly identities: Pick<AgentIdentityService, "verify"> | null;

  /**
   * Creates the service.
   *
   * @param repository - Storage of the hashed credentials.
   * @param identities - Resolves the current rights of the executor; only the
   * verifying side needs it.
   */
  public constructor(
    repository: AgentRunCredentialRepository,
    identities: Pick<AgentIdentityService, "verify"> | null = null,
  ) {
    this.repository = repository;
    this.identities = identities;
  }

  /**
   * Issues the credential of one node.
   *
   * @param userId - The executor of the run.
   * @param scope - The run, the node, its operations and tickets.
   * @param lifetimeMs - How long the credential may be used at most; zero keeps it valid until revocation.
   * @returns The clear text, which the caller hands only to the session environment.
   */
  public async issue(
    userId: string,
    scope: AgentRunScope,
    lifetimeMs: number,
  ): Promise<IssuedRunCredential> {
    const token = createAgentCredential();
    const createdAt = Date.now();
    const expiresAt =
      lifetimeMs === 0 ? Number.MAX_SAFE_INTEGER : createdAt + lifetimeMs;
    await this.repository.insert({
      id: randomUUID(),
      userId,
      scope,
      tokenHash: hashAgentCredential(token),
      createdAt,
      expiresAt,
    });
    return { token, expiresAt };
  }

  /**
   * Resolves a credential of a session to the current rights of its executor.
   *
   * @param token - The presented clear text.
   * @returns The identity with its run scope, or `null` when the text is no
   * valid session credential.
   */
  public async verify(token: string): Promise<AgentIdentity | null> {
    return this.verifyHash(hashAgentCredential(token));
  }

  /** Revalidates ephemeral binary capabilities without retaining a clear run credential. */
  public async verifyHash(hash: string): Promise<AgentIdentity | null> {
    if (this.identities === null) return null;
    const stored = await this.repository.findValid(hash, Date.now());
    if (!stored) return null;
    const identity = await this.identities.verify(stored.userId);
    return { ...identity, run: stored.scope };
  }

  /**
   * Ends the credentials of one node, or of a whole run when no node is named.
   *
   * @returns How many credentials were still valid before.
   */
  public async revoke(runId: string, stepId: string | null): Promise<number> {
    return this.repository.revoke(runId, stepId, Date.now());
  }
}
