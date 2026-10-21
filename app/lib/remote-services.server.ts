import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { RemoteConnectionRepository } from "@/backend/database/repositories/remote/RemoteConnectionRepository";
import { RemoteWorkspaceRepository } from "@/backend/database/repositories/remote/RemoteWorkspaceRepository";
import { RemoteSession } from "@/backend/remote/RemoteSession";
import { RemoteSessionRegistry } from "@/backend/remote/RemoteSessionRegistry";
import { SshClient } from "@/backend/remote/SshClient";
import { RemoteConnectionService } from "@/backend/service/remote/RemoteConnectionService";
import { RemoteWorkspaceService } from "@/backend/service/remote/RemoteWorkspaceService";

import type { Database } from "@/backend/database/Database";
import type { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";

/** SSH connections, remote workspace profiles and their live logical connections (PAGE-138). */
export interface RemoteApplicationServices {
  readonly remoteConnectionService: RemoteConnectionService;
  readonly remoteWorkspaceService: RemoteWorkspaceService;
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
  return {
    remoteConnectionService,
    remoteWorkspaceService: new RemoteWorkspaceService({
      workspaces: new RemoteWorkspaceRepository(database),
      connections,
      authorization,
      projects: new ProjectRepository(database),
      sessions: remoteSessions,
    }),
    remoteSessions,
    sshClient,
  };
}
