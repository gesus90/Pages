import { randomUUID } from "node:crypto";

import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { RemoteError } from "@/backend/error/RemoteErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import {
  canManageRemoteConnections,
  canUseRemoteConnection,
  requireRemoteAccount,
} from "./RemoteAccess";
import { readRemoteConnectionInput } from "./RemoteConnectionInput";
import {
  decryptRemoteCredentials,
  encryptRemoteSecrets,
  testRemoteCredentials,
} from "./RemoteConnectionSecrets";
import {
  remoteCheckOf,
  remoteFailureStage,
  testRemoteConnection,
} from "./RemoteConnectionTest";

import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import type {
  RemoteConnectionRecord,
  RemoteConnectionRepository,
} from "@/backend/database/repositories/remote/RemoteConnectionRepository";
import type { RemoteSessionRegistry } from "@/backend/remote/RemoteSessionRegistry";
import type { SshClient } from "@/backend/remote/SshClient";
import type { SshTarget } from "@/backend/remote/SshOptions";
import type { AccountAccess, Department } from "@/definition/Authorization";
import type {
  RemoteConnectionView,
  RemoteFailureCode,
  RemoteTestResult,
} from "@/definition/RemoteConnection";
import type { RemoteSecretCipher } from "./RemoteConnectionSecrets";
import type { ValidatedRemoteConnection } from "./RemoteConnectionInput";

/** Storage, authorization, cipher, SSH client and live connections of the remote connections. */
export interface RemoteConnectionDependencies {
  readonly connections: RemoteConnectionRepository;
  readonly authorization: Pick<AuthorizationRepository, "snapshot">;
  readonly cipher: RemoteSecretCipher;
  readonly client: Pick<SshClient, "probe" | "scanHostKey" | "authenticate">;
  readonly sessions: RemoteSessionRegistry;
}

/** The connections a person may see, with the departments administrators can choose. */
export interface RemoteConnectionScope {
  readonly canManage: boolean;
  readonly connections: readonly RemoteConnectionView[];
  readonly departments: readonly Department[];
}

/** The pinned key is filed under the connection, never under a host name a person typed. */
function aliasOf(connectionId: string | null): string {
  return `pages-remote-${connectionId ?? "test"}`;
}

function sameEndpoint(
  record: RemoteConnectionRecord,
  input: ValidatedRemoteConnection,
): boolean {
  return (
    record.host.toLowerCase() === input.host.toLowerCase() &&
    record.port === input.port
  );
}

/**
 * Administrators configure SSH connections; members of the shared department use them.
 *
 * @remarks
 * Configuration and credentials are separate from use: only administrators
 * create, change, test or remove a connection, and no view ever contains a
 * secret. Every call reads the account and its memberships again.
 */
export class RemoteConnectionService {
  private readonly dependencies: RemoteConnectionDependencies;
  private readonly writes = new SerialQueue();
  private readonly checking = new Set<string>();

  public constructor(dependencies: RemoteConnectionDependencies) {
    this.dependencies = dependencies;
  }

  /** Lists the connections the person may use; administrators see all of them. */
  public async scope(userId: string): Promise<RemoteConnectionScope> {
    const snapshot = await this.dependencies.authorization.snapshot();
    const actor = requireRemoteAccount(snapshot, userId);
    const canManage = canManageRemoteConnections(actor);
    const [records, counts] = await Promise.all([
      this.dependencies.connections.list(),
      this.dependencies.connections.workspaceCounts(),
    ]);
    const names = new Map(
      snapshot.departments.map((department) => [
        department.id,
        department.name,
      ]),
    );
    const connections = records
      .filter((record) => canUseRemoteConnection(actor, record.departmentId))
      .map((record) => ({
        id: record.id,
        name: record.name,
        host: record.host,
        port: record.port,
        username: record.username,
        authMethod: record.authMethod,
        departmentId: record.departmentId,
        departmentName: names.get(record.departmentId) ?? null,
        hostKey: record.hostKey,
        allowedRoots: record.allowedRoots,
        lastCheck: record.lastCheck,
        isChecking: this.checking.has(record.id),
        session: this.dependencies.sessions.view(record.id),
        workspaceCount: counts.get(record.id) ?? 0,
        revision: record.revision,
        canManage,
        storedSecrets: canManage
          ? {
              password: record.secrets.password !== null,
              privateKey: record.secrets.privateKey !== null,
              passphrase: record.secrets.passphrase !== null,
            }
          : null,
      }));
    return {
      canManage,
      connections,
      departments: canManage ? snapshot.departments : [],
    };
  }

  /**
   * Creates a connection; its secrets are stored encrypted only.
   *
   * @param userId - The administrator.
   * @param input - The dialog's input.
   * @returns The identifier of the new connection.
   */
  public async create(userId: string, input: unknown): Promise<string> {
    const validated = readRemoteConnectionInput(input, "save");
    return this.writes.run(async () => {
      const actor = await this.requireManager(userId);
      await this.requireDepartment(validated.departmentId);
      const id = randomUUID();
      const record = this.toRecord(id, validated, null);
      await this.dependencies.connections.create(record, actor.userId);
      this.startCheck(record.id);
      return id;
    });
  }

  /**
   * Changes a connection; empty secret fields keep the stored secrets.
   *
   * @remarks
   * A new host or port drops the pinned key unless a key was confirmed in the
   * same dialog. The open logical connection is closed, so the next step
   * connects with the new settings.
   *
   * @param userId - The administrator.
   * @param id - The connection.
   * @param input - The dialog's input with the revision read before.
   */
  public async update(
    userId: string,
    id: string,
    input: unknown,
  ): Promise<void> {
    const validated = readRemoteConnectionInput(input, "save");
    await this.writes.run(async () => {
      const actor = await this.requireManager(userId);
      const stored = await this.requireConnection(id);
      if (validated.revision !== stored.revision)
        throw new RemoteError("remote_conflict");
      await this.requireDepartment(validated.departmentId);
      const record = this.toRecord(id, validated, stored);
      await this.dependencies.connections.update(record, actor.userId);
      await this.dependencies.sessions.reset(id);
      this.startCheck(id);
    });
  }

  /**
   * Removes a connection that no workspace profile uses any more.
   *
   * @param userId - The administrator.
   * @param id - The connection.
   * @param revision - The revision read before.
   */
  public async remove(
    userId: string,
    id: string,
    revision: number,
  ): Promise<void> {
    await this.writes.run(async () => {
      await this.requireManager(userId);
      await this.dependencies.connections.remove(id, revision);
      await this.dependencies.sessions.reset(id);
    });
  }

  /**
   * Tests what the dialog holds, without storing anything.
   *
   * @param userId - The administrator.
   * @param id - The connection being edited, whose stored secrets fill empty fields, or `null`.
   * @param input - The dialog's input.
   * @returns The result of each stage and the presented host key.
   */
  public async test(
    userId: string,
    id: string | null,
    input: unknown,
  ): Promise<RemoteTestResult> {
    await this.requireManager(userId);
    const validated = readRemoteConnectionInput(input, "test");
    const stored = id === null ? null : await this.requireConnection(id);
    const keepsKey = stored !== null && sameEndpoint(stored, validated);
    return testRemoteConnection(this.dependencies.client, {
      alias: aliasOf(id),
      host: validated.host,
      port: validated.port,
      username: validated.username,
      credentials: testRemoteCredentials(
        validated,
        stored,
        this.dependencies.cipher,
      ),
      pinnedHostKey: validated.hostKey ?? (keepsKey ? stored.hostKey : null),
    });
  }

  /** Tests the stored connection in the background and keeps the result as its status. */
  public async testStored(userId: string, id: string): Promise<void> {
    await this.requireManager(userId);
    await this.requireConnection(id);
    this.startCheck(id);
  }

  /**
   * Starts a new series of reconnect attempts after a blocked one.
   *
   * @param userId - A person who may use the connection.
   * @param id - The connection.
   */
  public async reconnect(userId: string, id: string): Promise<void> {
    await this.requireUsable(userId, id);
    this.dependencies.sessions.session(id).reconnect();
  }

  /**
   * Rechecks that the person may use the connection right now.
   *
   * @param userId - The person who starts a step.
   * @param id - The connection.
   * @returns The stored connection.
   * @throws {RemoteError} `remote_access_denied` without a membership in its department.
   */
  public async requireUsable(
    userId: string,
    id: string,
  ): Promise<RemoteConnectionRecord> {
    const actor = await this.account(userId);
    const record = await this.dependencies.connections.find(id);
    if (!record || !canUseRemoteConnection(actor, record.departmentId))
      throw new RemoteError("remote_access_denied");
    return record;
  }

  /** Validates that an authenticated machine pairing still names the same SSH configuration. */
  public async scopeForRunner(id: string): Promise<number> {
    return (await this.requireConnection(id)).revision;
  }

  /**
   * What a logical connection connects with; read anew before every connect.
   *
   * @remarks
   * Without a pinned key nothing signs in. The machine is still probed, so a
   * series names an unreachable machine as the cause rather than the missing
   * confirmation.
   *
   * @param id - The connection.
   * @returns Machine, account, pinned key and decrypted credentials.
   * @throws {RemoteError} While no key is pinned, with the reachability
   * failure or `host_key_unconfirmed`.
   */
  public async sessionTarget(id: string): Promise<SshTarget> {
    const record = await this.requireConnection(id);
    if (!record.hostKey) {
      const unreachable = await this.dependencies.client.probe({
        host: record.host,
        port: record.port,
      });
      throw new RemoteError(
        "remote_host_key_unconfirmed",
        unreachable ?? "host_key_unconfirmed",
      );
    }
    return {
      alias: aliasOf(record.id),
      host: record.host,
      port: record.port,
      username: record.username,
      hostKey: record.hostKey,
      credentials: decryptRemoteCredentials(record, this.dependencies.cipher),
    };
  }

  /** Keeps the outcome of a connect as the connection's latest status. */
  public async recordConnect(
    id: string,
    failure: RemoteFailureCode | null,
  ): Promise<void> {
    const record = await this.dependencies.connections.find(id);
    if (!record) return;
    await this.dependencies.connections.saveCheck(id, record.revision, {
      checkedAt: new Date().toISOString(),
      stage: remoteFailureStage(failure),
      code: failure,
    });
  }

  private toRecord(
    id: string,
    validated: ValidatedRemoteConnection,
    stored: RemoteConnectionRecord | null,
  ): RemoteConnectionRecord {
    const keepsKey = stored !== null && sameEndpoint(stored, validated);
    return {
      id,
      name: validated.name,
      host: validated.host,
      port: validated.port,
      username: validated.username,
      authMethod: validated.authMethod,
      departmentId: validated.departmentId,
      hostKey: validated.hostKey ?? (keepsKey ? stored.hostKey : null),
      allowedRoots: validated.allowedRoots,
      secrets: encryptRemoteSecrets(
        {
          typed: validated,
          connectionId: id,
          stored: stored?.secrets ?? null,
        },
        this.dependencies.cipher,
      ),
      lastCheck: null,
      revision: stored?.revision ?? 1,
    };
  }

  /**
   * Runs a stored test once at a time per connection; the page polls until it ends.
   *
   * @remarks
   * A test after creating or changing a connection is its first connect, so a
   * machine that is not reachable or not confirmed yet starts a visible series.
   */
  private startCheck(id: string): void {
    if (this.checking.has(id)) return;
    this.checking.add(id);
    void this.runCheck(id).finally(() => this.checking.delete(id));
  }

  private async runCheck(id: string): Promise<void> {
    try {
      const record = await this.requireConnection(id);
      const result = await testRemoteConnection(this.dependencies.client, {
        alias: aliasOf(record.id),
        host: record.host,
        port: record.port,
        username: record.username,
        credentials: decryptRemoteCredentials(record, this.dependencies.cipher),
        pinnedHostKey: record.hostKey,
      });
      const check = remoteCheckOf(result);
      await this.dependencies.connections.saveCheck(id, record.revision, check);
      // A change or removal during the test brings its own test, or none.
      const current = await this.dependencies.connections.find(id);
      if (check.code !== null && current?.revision === record.revision)
        this.dependencies.sessions.session(id).retryAfter(check.code);
    } catch (error: unknown) {
      logCaughtError("RemoteConnectionService", error);
    }
  }

  private async account(userId: string): Promise<AccountAccess> {
    return requireRemoteAccount(
      await this.dependencies.authorization.snapshot(),
      userId,
    );
  }

  private async requireManager(userId: string): Promise<AccountAccess> {
    const actor = await this.account(userId);
    if (!canManageRemoteConnections(actor))
      throw new RemoteError("remote_management_denied");
    return actor;
  }

  private async requireConnection(id: string): Promise<RemoteConnectionRecord> {
    const record = await this.dependencies.connections.find(id);
    if (!record) throw new RemoteError("remote_connection_not_found");
    return record;
  }

  private async requireDepartment(departmentId: string): Promise<void> {
    const snapshot = await this.dependencies.authorization.snapshot();
    if (
      !snapshot.departments.some((department) => department.id === departmentId)
    )
      throw new RemoteError("remote_department_invalid");
  }
}
