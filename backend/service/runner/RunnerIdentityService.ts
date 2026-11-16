import { randomBytes, randomUUID } from "node:crypto";

import { registerLogSecret } from "@/backend/logging/LogRedaction";

import {
  LOCAL_RUNNER_CONNECTION_ID,
  provisionLocalRunner,
} from "./LocalRunnerIdentity";
import { digest, matches, GRANT_MILLISECONDS } from "./RunnerServiceSupport";

import type { SerialQueue } from "@/backend/concurrency/SerialQueue";
import type { RunnerRecord } from "@/backend/database/repositories/runner/RunnerRepository";
import type { RunnerAuthentication } from "./RunnerService";
import type {
  RunnerStore,
  RunnerConnectionAccess,
  RegistrationGrant,
} from "./RunnerServiceSupport";

interface RunnerIdentityContext {
  readonly repository: RunnerStore;
  readonly connections: RunnerConnectionAccess;
  readonly writes: SerialQueue;
  readonly requireSetup: (
    userId: string,
    connectionId: string,
  ) => Promise<void>;
  readonly requireRevision: (record: RunnerRecord) => Promise<void>;
}

/** Owns machine pairing and token authentication under the runner's shared write queue. */
export class RunnerIdentityService {
  private readonly context: RunnerIdentityContext;
  private readonly grants = new Map<string, RegistrationGrant>();

  public constructor(context: RunnerIdentityContext) {
    this.context = context;
  }

  /** Issues a single-use grant, bound to the administrator and current SSH revision. */
  public async authorize(
    userId: string,
    connectionId: string,
  ): Promise<{ readonly grant: string; readonly expiresAt: string }> {
    return this.context.writes.run(async () => {
      await this.context.requireSetup(userId, connectionId);
      for (const [id, grant] of this.grants)
        if (grant.expiresAt <= Date.now()) this.grants.delete(id);
      const connection = await this.context.connections.requireUsable(
        userId,
        connectionId,
      );
      const token = randomBytes(32).toString("base64url");
      registerLogSecret(token);
      const expiresAt = Date.now() + GRANT_MILLISECONDS;
      this.grants.set(connectionId, {
        digest: digest(token),
        userId,
        revision: connection.revision,
        expiresAt,
      });
      return { grant: token, expiresAt: new Date(expiresAt).toISOString() };
    });
  }

  /** Consumes a grant or verifies a stored token before any WebSocket upgrade. */
  public async authenticate(
    connectionId: string,
    credential: string,
  ): Promise<RunnerAuthentication> {
    return this.context.writes.run(async () => {
      if (credential.length > 200) throw new Error("Invalid runner credential");
      const record =
        connectionId === LOCAL_RUNNER_CONNECTION_ID
          ? await provisionLocalRunner(this.context.repository)
          : await this.context.repository.find(connectionId);
      if (connectionId === LOCAL_RUNNER_CONNECTION_ID && !record)
        throw new Error("Local runner is not provisioned");
      if (record) {
        await this.context.requireRevision(record);
        if (!matches(credential, record.tokenHash))
          throw new Error("Invalid runner credential");
        return {
          connectionId,
          runnerId: record.runnerId,
          token: null,
          sessionId: record.state.sessionId,
        };
      }
      const grant = this.grants.get(connectionId);
      if (
        !grant ||
        grant.expiresAt <= Date.now() ||
        !matches(credential, grant.digest)
      )
        throw new Error("Invalid runner grant");
      await this.context.requireSetup(grant.userId, connectionId);
      const connection = await this.context.connections.requireUsable(
        grant.userId,
        connectionId,
      );
      if (connection.revision !== grant.revision)
        throw new Error("Runner configuration changed");
      this.grants.delete(connectionId);
      const token = randomBytes(32).toString("base64url");
      registerLogSecret(token);
      const created: RunnerRecord = {
        connectionId,
        runnerId: randomUUID(),
        tokenHash: digest(token),
        connectionRevision: connection.revision,
        state: {
          version: 1,
          sessionId: randomUUID(),
          sequence: 0,
          lastEventId: null,
          jobs: [],
        },
      };
      await this.context.repository.create(created);
      return {
        connectionId,
        runnerId: created.runnerId,
        token,
        sessionId: created.state.sessionId,
      };
    });
  }

  /** Removes an unused registration grant after explicit identity revocation. */
  public forget(connectionId: string): void {
    this.grants.delete(connectionId);
  }
}
