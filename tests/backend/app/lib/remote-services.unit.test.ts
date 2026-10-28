import { beforeEach, expect, it, vi } from "vitest";

import { createRemoteServices } from "@/app/lib/remote-services.server";
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

const { fakeClasses, opaque } = await vi.hoisted(
  async () => import("./service-wiring-fakes"),
);

vi.mock("@/backend/database/repositories/AuthorizationRepository", () =>
  fakeClasses({ AuthorizationRepository: [] }),
);
vi.mock("@/backend/database/repositories/ProjectRepository", () =>
  fakeClasses({ ProjectRepository: [] }),
);
vi.mock(
  "@/backend/database/repositories/remote/RemoteConnectionRepository",
  () => fakeClasses({ RemoteConnectionRepository: [] }),
);
vi.mock(
  "@/backend/database/repositories/remote/RemoteInstallFindingRepository",
  () => fakeClasses({ RemoteInstallFindingRepository: [] }),
);
vi.mock(
  "@/backend/database/repositories/remote/RemoteWorkspaceRepository",
  () => fakeClasses({ RemoteWorkspaceRepository: [] }),
);
vi.mock("@/backend/remote/RemoteSession", () =>
  fakeClasses({ RemoteSession: [] }),
);
vi.mock("@/backend/remote/RemoteSessionRegistry", () =>
  fakeClasses({ RemoteSessionRegistry: [] }),
);
vi.mock("@/backend/remote/SshClient", () => fakeClasses({ SshClient: [] }));
vi.mock("@/backend/service/remote/RemoteConnectionService", () =>
  fakeClasses({
    RemoteConnectionService: ["sessionTarget", "recordConnect"],
  }),
);
vi.mock("@/backend/service/remote/RemoteWorkspaceService", () =>
  fakeClasses({ RemoteWorkspaceService: [] }),
);
vi.mock("@/backend/service/remote/RemoteConsoleService", () =>
  fakeClasses({ RemoteConsoleService: [] }),
);
vi.mock("@/backend/service/remote/setup/RemoteInstallService", () =>
  fakeClasses({ RemoteInstallService: ["inspectAfterConnect"] }),
);

const DATABASE = opaque<Database>("database");
const CIPHER = opaque<InstanceSecretCipher>("cipher");

beforeEach(() => {
  vi.resetAllMocks();
});

it("shares one SSH client, connection repository and session registry", () => {
  const services = createRemoteServices({
    database: DATABASE,
    cipher: CIPHER,
  });

  const [client] = vi.mocked(SshClient).mock.instances;
  const [connections] = vi.mocked(RemoteConnectionRepository).mock.instances;
  const [authorization] = vi.mocked(AuthorizationRepository).mock.instances;
  const [sessions] = vi.mocked(RemoteSessionRegistry).mock.instances;
  expect(services.sshClient).toBe(client);
  expect(services.remoteSessions).toBe(sessions);
  expect(vi.mocked(RemoteConnectionService).mock.calls[0][0]).toEqual({
    connections,
    authorization,
    cipher: CIPHER,
    client,
    sessions,
  });
  expect(vi.mocked(RemoteInstallService).mock.calls[0][0]).toEqual({
    findings: vi.mocked(RemoteInstallFindingRepository).mock.instances[0],
    connections,
    sessions,
  });
  expect(vi.mocked(RemoteWorkspaceService).mock.calls[0][0]).toEqual({
    workspaces: vi.mocked(RemoteWorkspaceRepository).mock.instances[0],
    connections,
    authorization,
    projects: vi.mocked(ProjectRepository).mock.instances[0],
    sessions,
  });
  for (const repository of [
    RemoteConnectionRepository,
    AuthorizationRepository,
    RemoteInstallFindingRepository,
    RemoteWorkspaceRepository,
    ProjectRepository,
  ]) {
    expect(vi.mocked(repository).mock.calls).toEqual([[DATABASE]]);
  }
});

it("returns the services and a console over workspaces and connections", () => {
  const services = createRemoteServices({
    database: DATABASE,
    cipher: CIPHER,
  });

  const [connection] = vi.mocked(RemoteConnectionService).mock.instances;
  const [workspaces] = vi.mocked(RemoteWorkspaceService).mock.instances;
  expect(services.remoteConnectionService).toBe(connection);
  expect(services.remoteWorkspaceService).toBe(workspaces);
  expect(services.remoteInstallService).toBe(
    vi.mocked(RemoteInstallService).mock.instances[0],
  );
  expect(services.remoteConsoleService).toBe(
    vi.mocked(RemoteConsoleService).mock.instances[0],
  );
  expect(vi.mocked(RemoteConsoleService).mock.calls[0][0]).toEqual({
    workspaces,
    connections: connection,
  });
});

it("creates each session lazily with callbacks bound to its connection", async () => {
  createRemoteServices({ database: DATABASE, cipher: CIPHER });
  vi.mocked(RemoteConnectionService.prototype.sessionTarget).mockResolvedValue(
    opaque("target"),
  );
  vi.mocked(RemoteConnectionService.prototype.recordConnect).mockResolvedValue(
    undefined,
  );
  vi.mocked(
    RemoteInstallService.prototype.inspectAfterConnect,
  ).mockResolvedValue(undefined);
  expect(vi.mocked(RemoteSession).mock.calls).toEqual([]);

  const [createSession] = vi.mocked(RemoteSessionRegistry).mock.calls[0];
  const session = createSession("connection-1");

  expect(session).toBe(vi.mocked(RemoteSession).mock.instances[0]);
  const [options] = vi.mocked(RemoteSession).mock.calls[0];
  expect(options.client).toBe(vi.mocked(SshClient).mock.instances[0]);
  await expect(options.target()).resolves.toEqual(opaque("target"));
  expect(
    vi.mocked(RemoteConnectionService.prototype.sessionTarget),
  ).toHaveBeenCalledWith("connection-1");
  await options.record(null);
  expect(
    vi.mocked(RemoteConnectionService.prototype.recordConnect),
  ).toHaveBeenCalledWith("connection-1", null);
  options.connected?.();
  expect(
    vi.mocked(RemoteInstallService.prototype.inspectAfterConnect),
  ).toHaveBeenCalledWith("connection-1");
});
