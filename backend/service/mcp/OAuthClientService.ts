import { randomUUID } from "node:crypto";

import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { fetchOAuthMetadata } from "@/backend/security/OAuthMetadataFetch";
import { parseOAuthClient } from "@/definition/McpOAuthClient";

import type { McpOAuthRepository } from "@/backend/database/repositories/mcp/McpOAuthRepository";
import type { McpOAuthClient } from "@/definition/McpAuthorization";

/** Prefers URL client identities (CIMD); DCR remains a separate compatibility step. */
export class OAuthClientService {
  private readonly repository: McpOAuthRepository;
  private readonly fetchMetadata: (clientId: string) => Promise<unknown>;

  public constructor(
    repository: McpOAuthRepository,
    fetchMetadata: (clientId: string) => Promise<unknown> = fetchOAuthMetadata,
  ) {
    this.repository = repository;
    this.fetchMetadata = fetchMetadata;
  }

  /** Registers a public client without issuing or accepting a client secret. */
  public async register(input: unknown): Promise<McpOAuthClient> {
    const client = this.parse(input, randomUUID());
    await this.repository.clients().save(client);
    return client;
  }

  /** Resolves a CIMD identity freshly or reads an existing DCR registration. */
  public async resolve(clientId: string): Promise<McpOAuthClient> {
    if (clientId.startsWith("https://")) {
      try {
        const metadata = await this.fetchMetadata(clientId);
        if (
          typeof metadata !== "object" ||
          metadata === null ||
          !("client_id" in metadata) ||
          metadata.client_id !== clientId
        ) {
          throw new McpAuthorizationError("invalid_client");
        }
        const client = this.parse(metadata, clientId);
        await this.repository.clients().save(client);
        return client;
      } catch {
        throw new McpAuthorizationError("invalid_client");
      }
    }
    const client = await this.repository.clients().find(clientId);
    if (!client) throw new McpAuthorizationError("invalid_client");
    return client;
  }

  private parse(input: unknown, clientId: string): McpOAuthClient {
    try {
      return parseOAuthClient(input, clientId);
    } catch {
      throw new McpAuthorizationError("invalid_client_metadata");
    }
  }
}
