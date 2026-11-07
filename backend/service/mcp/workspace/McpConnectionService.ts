import { readRemoteConnectionInput } from "@/backend/service/remote/RemoteConnectionInput";

import {
  confirmedHostKeyLine,
  connectionChangeQuestion,
} from "./McpConnectionChange";
import { projectConnection, projectTest } from "./McpWorkspaceProjection";
import { McpWorkspaceError } from "./McpWorkspaceError";

import type { RemoteConnectionView } from "@/definition/RemoteConnection";
import type { McpWorkspaceServices } from "./McpWorkspaceCatalog";
import type {
  McpConnectionChangeQuestion,
  McpConnectionRemovalQuestion,
  McpConnectionResponse,
  McpConnectionTestResponse,
  McpNamedReference,
} from "./McpWorkspaceContract";
import type {
  McpConnectionCreateRequest,
  McpConnectionTestRequest,
  McpConnectionUpdateRequest,
  McpRemovalRequest,
} from "./McpWorkspaceRequest";

/** The connections the account may use, with the departments an administrator can choose. */
export interface McpConnectionListResponse {
  readonly canManage: boolean;
  readonly connections: readonly McpConnectionResponse[];
  readonly departments: readonly McpNamedReference[];
}

/** An input object as the dialog of the interface sends it. */
type ConnectionInput = Readonly<Record<string, unknown>>;

/**
 * Fills the fields a change leaves out from the stored connection.
 *
 * @remarks
 * Secrets are not part of the stored view: a missing secret stays missing in
 * the input, which the service of the interface reads as "keep the stored one".
 */
function mergedInput(
  stored: RemoteConnectionView,
  request: McpConnectionUpdateRequest,
): ConnectionInput {
  return {
    name: request.name ?? stored.name,
    host: request.host ?? stored.host,
    port: request.port ?? stored.port,
    username: request.username ?? stored.username,
    authMethod: request.authMethod ?? stored.authMethod,
    departmentId: request.departmentId ?? stored.departmentId,
    allowedRoots: request.allowedRoots ?? stored.allowedRoots,
    password: request.password,
    privateKey: request.privateKey,
    passphrase: request.passphrase,
    revision: request.revision,
  };
}

/**
 * Manages SSH connections for a paired machine.
 *
 * @remarks
 * Every call runs through the connection service of the interface on the MCP
 * channel, which decides who may see, use or configure a connection. This
 * class only adds what the interface of the program needs on top: the host
 * key by fingerprint, the questions before risky changes, and the shape of
 * the answers. It never returns a secret or a full host key.
 */
export class McpConnectionService {
  private readonly services: McpWorkspaceServices;

  /**
   * Creates the service.
   *
   * @param services - The workspace and connection services, already on the MCP channel.
   */
  public constructor(services: McpWorkspaceServices) {
    this.services = services;
  }

  /** Lists the connections the account may use; administrators see all of them. */
  public async list(userId: string): Promise<McpConnectionListResponse> {
    const scope = await this.services.connections.scope(userId);
    return {
      canManage: scope.canManage,
      connections: scope.connections.map(projectConnection),
      departments: scope.departments.map(({ id, name }) => ({ id, name })),
    };
  }

  /**
   * Reads one connection the account may use.
   *
   * @param userId - The paired account.
   * @param id - The connection.
   * @throws {McpWorkspaceError} `not_found` for a missing or hidden connection.
   */
  public async read(
    userId: string,
    id: string,
  ): Promise<{ readonly connection: McpConnectionResponse }> {
    return { connection: projectConnection(await this.view(userId, id)) };
  }

  /**
   * Tests a connection without storing anything.
   *
   * @remarks
   * With a fingerprint the machine is asked for its key first. Only a key
   * whose fingerprint is exactly the given one is used for the sign-in test;
   * another key answers `host_key_mismatch`. A machine that shows no key
   * answers with the test result, which names the stage that failed.
   *
   * @param userId - The paired account, an administrator.
   * @param request - The connection to test.
   */
  public async test(
    userId: string,
    request: McpConnectionTestRequest,
  ): Promise<{ readonly test: McpConnectionTestResponse }> {
    const { connectionId = null, hostKeyFingerprint, ...fields } = request;
    const { connections } = this.services;
    if (hostKeyFingerprint === undefined)
      return {
        test: projectTest(await connections.test(userId, connectionId, fields)),
      };
    await connections.requireManagement(userId);
    if (connectionId !== null) await this.view(userId, connectionId);
    // The first look has no pinned key, so no secret is sent to the machine.
    const probe = await connections.test(userId, null, fields);
    const hostKey = confirmedHostKeyLine(probe, hostKeyFingerprint);
    if (hostKey !== null)
      return {
        test: projectTest(
          await connections.test(userId, connectionId, { ...fields, hostKey }),
        ),
      };
    if (probe.presentedHostKey !== null)
      throw new McpWorkspaceError("host_key_mismatch");
    return { test: projectTest(probe) };
  }

  /**
   * Creates a connection; its secrets are stored encrypted only.
   *
   * @param userId - The paired account, an administrator.
   * @param request - The connection to create.
   * @throws {McpWorkspaceError} `host_key_mismatch` when the fingerprint does not
   * match the key the machine shows; nothing is stored then.
   */
  public async create(
    userId: string,
    request: McpConnectionCreateRequest,
  ): Promise<{ readonly connection: McpConnectionResponse }> {
    await this.services.connections.requireManagement(userId);
    const { hostKeyFingerprint, ...fields } = request;
    const input = await this.withConfirmedKey(
      userId,
      fields,
      hostKeyFingerprint,
    );
    const id = await this.services.connections.create(userId, input);
    return { connection: projectConnection(await this.view(userId, id)) };
  }

  /**
   * Changes a connection after the checks of the interface.
   *
   * @remarks
   * Missing fields keep their stored value. A change that leaves workspaces
   * outside the allowed directories, or another department, changes nothing
   * and returns the question with its scope until the client confirms.
   *
   * @param userId - The paired account, an administrator.
   * @param id - The connection.
   * @param request - The fields to change with the revision read before.
   * @throws {McpWorkspaceError} `conflict` for a stale revision, `host_key_mismatch`
   * when the fingerprint does not match the key the machine shows.
   */
  public async update(
    userId: string,
    id: string,
    request: McpConnectionUpdateRequest,
  ): Promise<
    { readonly connection: McpConnectionResponse } | McpConnectionChangeQuestion
  > {
    await this.services.connections.requireManagement(userId);
    const stored = await this.view(userId, id);
    if (request.revision !== stored.revision)
      throw new McpWorkspaceError("conflict");
    const merged = mergedInput(stored, request);
    if (request.confirmed !== true) {
      const question = await this.changeQuestion(userId, stored, merged);
      if (question !== null) return question;
    }
    const input = await this.withConfirmedKey(
      userId,
      merged,
      request.hostKeyFingerprint,
    );
    await this.services.connections.update(userId, id, input);
    return { connection: projectConnection(await this.view(userId, id)) };
  }

  /**
   * Starts the check of a stored connection in the background.
   *
   * @param userId - The paired account, an administrator.
   * @param id - The connection.
   * @returns The connection, which is checking until the result is stored.
   */
  public async check(
    userId: string,
    id: string,
  ): Promise<{ readonly connection: McpConnectionResponse }> {
    await this.services.connections.testStored(userId, id);
    return { connection: projectConnection(await this.view(userId, id)) };
  }

  /**
   * Starts a new series of connection attempts.
   *
   * @param userId - A paired account that may use the connection.
   * @param id - The connection.
   * @throws {McpWorkspaceError} `not_found` for a missing or hidden connection.
   */
  public async reconnect(
    userId: string,
    id: string,
  ): Promise<{ readonly connection: McpConnectionResponse }> {
    await this.view(userId, id);
    await this.services.connections.reconnect(userId, id);
    return { connection: projectConnection(await this.view(userId, id)) };
  }

  /**
   * Removes a connection no workspace uses, after a confirmation.
   *
   * @remarks
   * A connection that workspaces still use is `in_use` with or without
   * confirmation. Its stored secrets are deleted with it.
   *
   * @param userId - The paired account, an administrator.
   * @param id - The connection.
   * @param request - The revision read before and the confirmation.
   * @throws {McpWorkspaceError} `conflict` for a stale revision, `in_use` while
   * workspaces use the connection.
   */
  public async remove(
    userId: string,
    id: string,
    request: McpRemovalRequest,
  ): Promise<McpConnectionRemovalQuestion | { readonly removed: true }> {
    await this.services.connections.requireManagement(userId);
    const stored = await this.view(userId, id);
    if (request.revision !== stored.revision)
      throw new McpWorkspaceError("conflict");
    if (stored.workspaceCount > 0) throw new McpWorkspaceError("in_use");
    if (request.confirmed !== true)
      return {
        confirmationRequired: true,
        connection: { id: stored.id, name: stored.name, host: stored.host },
      };
    await this.services.connections.remove(userId, id, request.revision);
    return { removed: true };
  }

  /** The connection as the account sees it; one it may not use is not found. */
  private async view(
    userId: string,
    id: string,
  ): Promise<RemoteConnectionView> {
    const scope = await this.services.connections.scope(userId);
    const view = scope.connections.find((entry) => entry.id === id);
    if (view === undefined) throw new McpWorkspaceError("not_found");
    return view;
  }

  /**
   * Adds the host key the machine shows when its fingerprint is the given one.
   *
   * @remarks
   * The machine is asked for its key before anything is stored, with the
   * test of the interface. Without a fingerprint the input stays as it is.
   */
  private async withConfirmedKey(
    userId: string,
    fields: ConnectionInput,
    fingerprint: string | undefined,
  ): Promise<ConnectionInput> {
    if (fingerprint === undefined) return fields;
    const probe = await this.services.connections.test(userId, null, fields);
    const hostKey = confirmedHostKeyLine(probe, fingerprint);
    if (hostKey === null) throw new McpWorkspaceError("host_key_mismatch");
    return { ...fields, hostKey };
  }

  private async changeQuestion(
    userId: string,
    stored: RemoteConnectionView,
    merged: ConnectionInput,
  ): Promise<McpConnectionChangeQuestion | null> {
    const validated = readRemoteConnectionInput(merged, "save");
    const workspaces = (await this.services.remote.list(userId)).filter(
      (workspace) => workspace.connectionId === stored.id,
    );
    return connectionChangeQuestion(stored, validated, workspaces);
  }
}
