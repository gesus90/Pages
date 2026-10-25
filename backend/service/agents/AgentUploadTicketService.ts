import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import {
  createAgentCredential,
  hashAgentCredential,
} from "@/backend/security/AgentCredential";

import type { AgentIdentity } from "@/definition/McpAuthorization";

interface UploadAuthority {
  readonly credentialHash: string;
  readonly userId: string;
  readonly fileName: string;
  readonly ticketId?: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

/** One-use, process-local upload capabilities; neither tickets nor original credentials are retained in clear text. */
export class AgentUploadTicketService {
  private readonly tickets = new Map<string, UploadAuthority>();
  private readonly verify: (
    hash: string,
    issuedAt: number,
  ) => Promise<AgentIdentity>;

  public constructor(
    verify: (hash: string, issuedAt: number) => Promise<AgentIdentity>,
  ) {
    this.verify = verify;
  }

  /** Issues a five-minute capability only after the API has authenticated and authorized its owner. */
  public issue(
    token: string,
    userId: string,
    fileName: string,
    ticketId?: string,
  ): { readonly ticket: string; readonly expiresAt: number } {
    for (const [hash, authority] of this.tickets) {
      if (authority.expiresAt <= Date.now()) this.tickets.delete(hash);
    }
    const ticket = createAgentCredential();
    const issuedAt = Date.now();
    const expiresAt = issuedAt + 300_000;
    this.tickets.set(hashAgentCredential(ticket), {
      credentialHash: hashAgentCredential(token),
      userId,
      fileName,
      ticketId,
      issuedAt,
      expiresAt,
    });
    return { ticket, expiresAt };
  }

  /** Consumes synchronously before reading any bytes; failed attempts cannot replay. */
  public async consume(ticket: string): Promise<{
    readonly fileName: string;
    readonly ticketId?: string;
    readonly revalidate: () => Promise<AgentIdentity>;
  }> {
    const hash = hashAgentCredential(ticket);
    const authority = this.tickets.get(hash);
    this.tickets.delete(hash);
    if (!authority || authority.expiresAt <= Date.now())
      throw new McpAuthorizationError("invalid_token", 401);
    const revalidate = async (): Promise<AgentIdentity> => {
      const identity = await this.verify(
        authority.credentialHash,
        authority.issuedAt,
      );
      if (identity.userId !== authority.userId)
        throw new McpAuthorizationError("invalid_token", 401);
      return identity;
    };
    await revalidate();
    return {
      fileName: authority.fileName,
      ticketId: authority.ticketId,
      revalidate,
    };
  }
}
