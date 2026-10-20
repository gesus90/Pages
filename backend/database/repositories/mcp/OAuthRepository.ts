import { randomUUID } from "node:crypto";

import { readTextColumn, readCountColumn } from "@/backend/database/RowValue";
import { hashAgentCredential } from "@/backend/security/AgentCredential";
import { oauthClientSchema, oauthCodeSchema } from "@/definition/McpOAuth";

import { PersonalAgentTokenRepository } from "./PersonalAgentTokenRepository";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type {
  OAuthClientMetadata,
  OAuthCodeParameters,
} from "@/definition/McpOAuth";

/** Persists public registrations and hashed grants, never reusable plaintext credentials. */
export class OAuthRepository {
  private readonly database: Database;

  public constructor(database: Database) {
    this.database = database;
  }

  /** Registers one bounded public client after expiring unused registrations. */
  public async register(metadata: OAuthClientMetadata): Promise<string> {
    return this.database.transaction(async (scope) => {
      await scope.execute(
        "DELETE FROM mcp_http_clients WHERE expires_at <= $now;",
        { now: Date.now() },
      );
      const rows = await scope.query("SELECT COUNT(*) FROM mcp_http_clients;");
      if (readCountColumn(rows[0], 0, "count") >= 1000)
        throw new Error("Registration capacity reached.");
      const id = randomUUID();
      await scope.execute(
        `
        INSERT INTO mcp_http_clients (id, metadata, expires_at)
        VALUES ($id, $metadata, $expiry);
      `,
        {
          id,
          metadata: JSON.stringify(metadata),
          expiry: Date.now() + 30 * 86400000,
        },
      );
      return id;
    });
  }

  /** Resolves only an unexpired registration. */
  public async client(id: string): Promise<OAuthClientMetadata | null> {
    const rows = await this.database.query(
      `
      SELECT metadata FROM mcp_http_clients
      WHERE id = $id
          AND expires_at > $now;
    `,
      { id, now: Date.now() },
    );
    return rows[0]
      ? oauthClientSchema.parse(
          JSON.parse(readTextColumn(rows[0], 0, "metadata")),
        )
      : null;
  }

  /** Saves a two-minute code by hash; expiry removes unusable pending codes. */
  public async saveCode(
    code: string,
    parameters: OAuthCodeParameters,
    expiresAt: number,
  ): Promise<void> {
    await this.database.transaction(async (scope) => {
      await scope.execute(
        "DELETE FROM mcp_http_codes WHERE expires_at <= $now;",
        { now: Date.now() },
      );
      await scope.execute(
        `
        INSERT INTO mcp_http_codes (code_hash, parameters, expires_at)
        VALUES ($hash, $parameters, $expiry);
      `,
        {
          hash: hashAgentCredential(code),
          parameters: JSON.stringify(parameters),
          expiry: expiresAt,
        },
      );
    });
  }

  /** Reads code bindings for the OAuth library without marking the code used yet. */
  public async code(
    code: string,
  ): Promise<{ parameters: OAuthCodeParameters; expiresAt: number } | null> {
    const rows = await this.database.query(
      `
      SELECT
          parameters,
          expires_at
      FROM mcp_http_codes
      WHERE code_hash = $hash
          AND expires_at > $now;
    `,
      { hash: hashAgentCredential(code), now: Date.now() },
    );
    if (!rows[0]) return null;
    return {
      parameters: oauthCodeSchema.parse(
        JSON.parse(readTextColumn(rows[0], 0, "parameters")),
      ),
      expiresAt: readCountColumn(rows[0], 1, "expires_at"),
    };
  }

  /** Only one concurrent exchange may consume a code, including failed PKCE attempts. */
  public async consume(code: string): Promise<boolean> {
    const rows = await this.database.query(
      `
      DELETE FROM mcp_http_codes
      WHERE code_hash = $hash AND expires_at > $now
      RETURNING code_hash;
    `,
      { hash: hashAgentCredential(code), now: Date.now() },
    );
    return rows.length === 1;
  }

  /** Issues an auditable, revocable personal connection and its immutable audience atomically. */
  public async issue(input: {
    token: string;
    userId: string;
    name: string;
    resource: string;
    expiresAt: number;
  }): Promise<void> {
    await this.database.transaction(async (scope) => {
      await this.savePersonal(scope, input);
      await scope.execute(
        "DELETE FROM mcp_http_access WHERE expires_at <= $now;",
        { now: Date.now() },
      );
      await scope.execute(
        `
        INSERT INTO mcp_http_access (token_hash, resource, expires_at)
        VALUES ($hash, $resource, $expiry);
      `,
        {
          hash: hashAgentCredential(input.token),
          resource: input.resource,
          expiry: input.expiresAt,
        },
      );
    });
  }

  /** Rechecks the audience and hard access lifetime even if personal preferences later change. */
  public async accepts(token: string, resource: string): Promise<boolean> {
    const rows = await this.database.query(
      `
      SELECT token_hash FROM mcp_http_access
      WHERE token_hash = $hash
          AND resource = $resource
          AND expires_at > $now;
    `,
      { hash: hashAgentCredential(token), resource, now: Date.now() },
    );
    return rows.length === 1;
  }

  private async savePersonal(
    scope: DatabaseTransaction,
    input: {
      token: string;
      userId: string;
      name: string;
      resource: string;
      expiresAt: number;
    },
  ): Promise<void> {
    const repository = new PersonalAgentTokenRepository({
      ...scope,
      transaction: async (work) => work(scope),
    });
    await repository.insert(
      {
        id: randomUUID(),
        userId: input.userId,
        name: input.name,
        source: "oauth",
        device: input.resource,
        createdAt: Date.now(),
        expiresAt: input.expiresAt,
        revokedAt: null,
        lastUsedAt: null,
        rotatedAt: null,
        rotationRequestedAt: null,
      },
      hashAgentCredential(input.token),
    );
  }
}
