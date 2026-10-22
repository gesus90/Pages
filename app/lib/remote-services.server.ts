import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { RemoteConnectionRepository } from "@/backend/database/repositories/remote/RemoteConnectionRepository";
import { RemoteInstallFindingRepository } from "@/backend/database/repositories/remote/RemoteInstallFindingRepository";
import { RemoteWorkspaceRepository } from "@/backend/database/repositories/remote/RemoteWorkspaceRepository";
import { RemoteSession } from "@/backend/remote/RemoteSession";
import { RemoteSessionRegistry } from "@/backend/remote/RemoteSessionRegistry";
import { SshClient } from "@/backend/remote/SshClient";
import { RemoteConnectionService } from "@/backend/service/remote/RemoteConnectionService";
import { RemoteWorkspaceService } from "@/backend/service/remote/RemoteWorkspaceService";
import { RemoteConsoleService } from "@/backend/service/remote/RemoteConsoleService";
import { RemoteInstallService } from "@/backend/service/remote/setup/RemoteInstallService";

import type { Database } from "@/backend/database/Database";
import type { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";

/** SSH connections, remote workspace profiles and their live logical connections (PAGE-138). */
export interface RemoteApplicationServices {
  readonly remoteConnectionService: RemoteConnectionService;
  readonly remoteWorkspaceService: RemoteWorkspaceService;
  readonly remoteConsoleService: RemoteConsoleService;
  /** What each connected machine has installed; bound to host, port, user and host key. */
  readonly remoteInstallService: RemoteInstallService;
  /** Closed at shutdown together with the private SSH runtime folder. */
  readonly remoteSessions: RemoteSessionRegistry;
  readonly sshClient: SshClient;
}

/**
 * Builds the remote services on the existing instance cipher, so SSH secrets
 * use the same protected storage as the API keys of agent connections.
 *
 * @param input - The database and the instance cipher.
 * @returns The services; nothing connects until a person tests or uses a connection.
 */
export function createRemoteServices(input: {
  readonly database: Database;
  readonly cipher: InstanceSecretCipher;
}): RemoteApplicationServices {
  const { database, cipher } = input;
  const sshClient = new SshClient();
  const connections = new RemoteConnectionRepository(database);
  const authorization = new AuthorizationRepository(database);
  // Sessions are created on first use, when the connection service exists.
  const remoteSessions: RemoteSessionRegistry = new RemoteSessionRegistry(
    (connectionId): RemoteSession =>
      new RemoteSession({
        client: sshClient,
        target: () => remoteConnectionService.sessionTarget(connectionId),
        record: (failure) =>
          remoteConnectionService.recordConnect(connectionId, failure),
        connected: () => remoteInstallService.inspectAfterConnect(connectionId),
      }),
  );
  const remoteConnectionService: RemoteConnectionService =
    new RemoteConnectionService({
      connections,
      authorization,
      cipher,
      client: sshClient,
      sessions: remoteSessions,
    });
  const remoteInstallService: RemoteInstallService = new RemoteInstallService({
    findings: new RemoteInstallFindingRepository(database),
    connections,
    sessions: remoteSessions,
  });
  const remoteWorkspaceService = new RemoteWorkspaceService({
    workspaces: new RemoteWorkspaceRepository(database),
    connections,
    authorization,
    projects: new ProjectRepository(database),
    sessions: remoteSessions,
  });
  return {
    remoteConnectionService,
    remoteWorkspaceService,
    remoteConsoleService: new RemoteConsoleService({
      workspaces: remoteWorkspaceService,
      connections: remoteConnectionService,
    }),
    remoteInstallService,
    remoteSessions,
    sshClient,
  };
}
