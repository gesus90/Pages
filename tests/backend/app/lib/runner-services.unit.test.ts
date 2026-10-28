import { beforeEach, expect, it, vi } from "vitest";

import { createPlanWorkspaceAccess } from "@/app/lib/plan-access-services.server";
import { createRunnerServices } from "@/app/lib/runner-services.server";
import { AgentPlanRemoteTargets } from "@/backend/service/agents/AgentPlanRemoteTargets";
import { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import { RunnerPlanEventRepository } from "@/backend/database/repositories/runner/RunnerPlanEventRepository";
import { RunnerPlanEventService } from "@/backend/service/runner/RunnerPlanEventService";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { RunnerRepository } from "@/backend/database/repositories/runner/RunnerRepository";
import { RunnerDeployKeyRepository } from "@/backend/database/repositories/runner/RunnerDeployKeyRepository";
import { RunnerService } from "@/backend/service/runner/RunnerService";
import { RunnerGitHubAccessService } from "@/backend/service/runner/RunnerGitHubAccessService";
import { RunnerOpenRouterService } from "@/backend/service/runner/RunnerOpenRouterService";
import { RunnerSetupService } from "@/backend/service/runner/RunnerSetupService";
import { RemoteSetupService } from "@/backend/service/remote/setup/RemoteSetupService";
import { RunnerDeployKeyService } from "@/backend/service/runner/RunnerDeployKeyService";
import { RunnerGitHubContext } from "@/backend/service/runner/RunnerGitHubContext";
import { OfflineRunnerGitHubClient } from "@/backend/service/runner/OfflineRunnerGitHubClient";
import { HttpRunnerGitHubClient } from "@/backend/service/runner/HttpRunnerGitHubClient";

import type { Mock } from "vitest";

import type { Database } from "@/backend/database/Database";
import type { AgentPlanAccess } from "@/backend/service/agents/AgentPlanAccess";
import type { AgentPlanWorkspaces } from "@/backend/service/agents/AgentPlanWorkspaces";
import type { AgentProfileService } from "@/backend/service/agents/AgentProfileService";
import type { AgentWorkspaceService } from "@/backend/service/agents/AgentWorkspaceService";
import type { RemoteApplicationServices } from "@/app/lib/remote-services.server";
import type { RemoteConsoleService } from "@/backend/service/remote/RemoteConsoleService";
import type { RemoteInstallService } from "@/backend/service/remote/setup/RemoteInstallService";

const { fakeClasses, opaque, partial } = await vi.hoisted(
  async () => import("./service-wiring-fakes"),
);

vi.mock("@/app/lib/plan-access-services.server", () => ({
  createPlanWorkspaceAccess: vi.fn(),
}));
vi.mock("@/backend/service/agents/AgentPlanRemoteTargets", () =>
  fakeClasses({ AgentPlanRemoteTargets: [] }),
);
vi.mock("@/backend/database/repositories/agent/AgentPlanRepository", () =>
  fakeClasses({ AgentPlanRepository: [] }),
);
vi.mock("@/backend/database/repositories/agent/AgentPlanRunRepository", () =>
  fakeClasses({ AgentPlanRunRepository: [] }),
);
vi.mock(
  "@/backend/database/repositories/runner/RunnerPlanEventRepository",
  () => fakeClasses({ RunnerPlanEventRepository: [] }),
);
vi.mock("@/backend/service/runner/RunnerPlanEventService", () =>
  fakeClasses({ RunnerPlanEventService: [] }),
);
vi.mock("@/backend/database/repositories/ProjectRepository", () =>
  fakeClasses({ ProjectRepository: [] }),
);
vi.mock("@/backend/database/repositories/runner/RunnerRepository", () =>
  fakeClasses({ RunnerRepository: [] }),
);
vi.mock(
  "@/backend/database/repositories/runner/RunnerDeployKeyRepository",
  () => fakeClasses({ RunnerDeployKeyRepository: [] }),
);
vi.mock("@/backend/service/runner/RunnerService", () =>
  fakeClasses({ RunnerService: ["status"] }),
);
vi.mock("@/backend/service/runner/RunnerGitHubAccessService", () =>
  fakeClasses({ RunnerGitHubAccessService: [] }),
);
vi.mock("@/backend/service/runner/RunnerOpenRouterService", () =>
  fakeClasses({ RunnerOpenRouterService: [] }),
);
vi.mock("@/backend/service/runner/RunnerSetupService", () =>
  fakeClasses({ RunnerSetupService: [] }),
);
vi.mock("@/backend/service/remote/setup/RemoteSetupService", () =>
  fakeClasses({ RemoteSetupService: [] }),
);
vi.mock("@/backend/service/runner/RunnerDeployKeyService", () =>
  fakeClasses({ RunnerDeployKeyService: [] }),
);
vi.mock("@/backend/service/runner/RunnerGitHubContext", () =>
  fakeClasses({ RunnerGitHubContext: [] }),
);
vi.mock("@/backend/service/runner/OfflineRunnerGitHubClient", () =>
  fakeClasses({ OfflineRunnerGitHubClient: [] }),
);
vi.mock("@/backend/service/runner/HttpRunnerGitHubClient", () =>
  fakeClasses({ HttpRunnerGitHubClient: [] }),
);

const DATABASE = opaque<Database>("database");
const TOKEN_KEY = Buffer.from("token-key");
const WORKSPACES = opaque<AgentWorkspaceService>("workspaces");
const PROFILES = opaque<AgentProfileService>("profiles");
const ACCESS = opaque<AgentPlanAccess>("plan access");

interface RemoteFixture {
  readonly remote: RemoteApplicationServices;
  readonly attachSetup: Mock<RemoteConsoleService["attachSetup"]>;
  readonly hasSetup: Mock<RemoteConsoleService["hasSetup"]>;
  readonly attach: Mock<RemoteInstallService["attach"]>;
}

/** Remote services whose console and install findings record what the runner wiring attaches. */
function remoteFixture(): RemoteFixture {
  const attachSetup = vi.fn<RemoteConsoleService["attachSetup"]>();
  const hasSetup = vi.fn<RemoteConsoleService["hasSetup"]>(() => true);
  const attach = vi.fn<RemoteInstallService["attach"]>();
  const remote: RemoteApplicationServices = {
    remoteConnectionService: opaque("connections"),
    remoteWorkspaceService: opaque("remote workspaces"),
    remoteConsoleService: partial({ attachSetup, hasSetup }),
    remoteInstallService: partial({ attach }),
    remoteSessions: opaque("sessions"),
    sshClient: opaque("ssh"),
  };
  return { remote, attachSetup, hasSetup, attach };
}

function create(
  remote = remoteFixture().remote,
): ReturnType<typeof createRunnerServices> {
  return createRunnerServices({
    database: DATABASE,
    remote,
    tokenKey: TOKEN_KEY,
    configuration: {
      agentWorkspaceService: WORKSPACES,
      agentProfileService: PROFILES,
    },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createPlanWorkspaceAccess).mockReturnValue({
    access: ACCESS,
    workspaceCatalog: opaque<AgentPlanWorkspaces>("catalog"),
  });
});

it("wires the runner service with plan events over the current plan access", () => {
  const { remote } = remoteFixture();
  const services = create(remote);

  const [runnerService] = vi.mocked(RunnerService).mock.instances;
  expect(services.runnerService).toBe(runnerService);
  expect(vi.mocked(RunnerService).mock.calls[0]).toEqual([
    vi.mocked(RunnerRepository).mock.instances[0],
    remote.remoteConnectionService,
    vi.mocked(RunnerPlanEventService).mock.instances[0],
  ]);
  expect(vi.mocked(RunnerPlanEventService).mock.calls[0]).toEqual([
    vi.mocked(RunnerPlanEventRepository).mock.instances[0],
    {
      plans: ACCESS,
      runs: vi.mocked(AgentPlanRunRepository).mock.instances[0],
      profiles: PROFILES,
      targets: vi.mocked(AgentPlanRemoteTargets).mock.instances[0],
    },
  ]);
  expect(vi.mocked(createPlanWorkspaceAccess).mock.calls[0]).toEqual([
    {
      database: DATABASE,
      agents: {
        agentWorkspaceService: WORKSPACES,
        agentProfileService: PROFILES,
        ...remote,
      },
    },
    vi.mocked(AgentPlanRepository).mock.instances[0],
  ]);
  expect(vi.mocked(AgentPlanRemoteTargets).mock.calls[0]).toEqual([
    remote.remoteWorkspaceService,
    remote.remoteConnectionService,
  ]);
  for (const repository of [
    RunnerRepository,
    RunnerPlanEventRepository,
    AgentPlanRepository,
    AgentPlanRunRepository,
    ProjectRepository,
  ]) {
    expect(vi.mocked(repository).mock.calls).toEqual([[DATABASE]]);
  }
});

it("keeps GitHub offline by default with deploy keys from the database", () => {
  vi.stubEnv("PAGES_RUNNER_GITHUB_MODE", undefined);
  const { remote } = remoteFixture();
  const services = create(remote);

  const [context] = vi.mocked(RunnerGitHubContext).mock.instances;
  expect(services.runnerGitHubMode).toBe("offline");
  expect(vi.mocked(RunnerGitHubContext).mock.calls[0]).toEqual([
    vi.mocked(ProjectRepository).mock.instances[0],
    TOKEN_KEY,
  ]);
  expect(vi.mocked(HttpRunnerGitHubClient)).not.toHaveBeenCalled();
  expect(vi.mocked(OfflineRunnerGitHubClient).mock.calls[0]).toEqual([
    vi.mocked(RunnerDeployKeyRepository).mock.instances[0],
    context,
  ]);
  expect(vi.mocked(RunnerDeployKeyService).mock.calls[0]).toEqual([
    vi.mocked(OfflineRunnerGitHubClient).mock.instances[0],
    WORKSPACES,
    {
      workspaces: remote.remoteWorkspaceService,
      connections: remote.remoteConnectionService,
      access: services.runnerGitHubAccessService,
      context,
    },
  ]);
  expect(services.runnerDeployKeyService).toBe(
    vi.mocked(RunnerDeployKeyService).mock.instances[0],
  );
});

it("contacts GitHub over HTTP only when configured explicitly", () => {
  vi.stubEnv("PAGES_RUNNER_GITHUB_MODE", "http");

  const services = create();

  expect(services.runnerGitHubMode).toBe("http");
  expect(vi.mocked(OfflineRunnerGitHubClient)).not.toHaveBeenCalled();
  expect(vi.mocked(HttpRunnerGitHubClient).mock.calls[0]).toEqual([
    vi.mocked(RunnerGitHubContext).mock.instances[0],
  ]);
  expect(vi.mocked(RunnerDeployKeyService).mock.calls[0][0]).toBe(
    vi.mocked(HttpRunnerGitHubClient).mock.instances[0],
  );
});

it("refuses an unknown GitHub mode before building anything", () => {
  vi.stubEnv("PAGES_RUNNER_GITHUB_MODE", "online");

  expect(() => create()).toThrow("Invalid runner GitHub mode");
  expect(vi.mocked(RunnerService)).not.toHaveBeenCalled();
});

it("derives access and model services from the one runner service", () => {
  const services = create();

  const [runnerService] = vi.mocked(RunnerService).mock.instances;
  expect(vi.mocked(RunnerGitHubAccessService).mock.calls).toEqual([
    [runnerService],
  ]);
  expect(services.runnerGitHubAccessService).toBe(
    vi.mocked(RunnerGitHubAccessService).mock.instances[0],
  );
  expect(vi.mocked(RunnerOpenRouterService).mock.calls).toEqual([
    [runnerService],
  ]);
  expect(services.runnerOpenRouterService).toBe(
    vi.mocked(RunnerOpenRouterService).mock.instances[0],
  );
});

it("delivers setups through the remote session and the configured folder", () => {
  vi.stubEnv("PAGES_RUNNER_SETUP_DIRECTORY", "/srv/runner-setup");
  vi.stubEnv("PAGES_RUNNER_PUBLIC_URL", undefined);
  const { remote, attachSetup } = remoteFixture();
  const services = create(remote);

  const [runnerService] = vi.mocked(RunnerService).mock.instances;
  expect(vi.mocked(RunnerSetupService).mock.calls[0][0]).toEqual({
    runners: runnerService,
    connections: remote.remoteConnectionService,
    sessions: remote.remoteSessions,
    directory: "/srv/runner-setup",
  });
  expect(services.runnerSetupService).toBe(
    vi.mocked(RunnerSetupService).mock.instances[0],
  );
  expect(vi.mocked(RemoteSetupService).mock.calls[0][0]).toEqual({
    connections: remote.remoteConnectionService,
    runners: runnerService,
    delivery: services.runnerSetupService,
    sessions: remote.remoteSessions,
    install: remote.remoteInstallService,
    publicUrl: null,
  });
  expect(services.remoteSetupService).toBe(
    vi.mocked(RemoteSetupService).mock.instances[0],
  );
  expect(attachSetup).toHaveBeenCalledWith(services.remoteSetupService);
});

it("lets install findings ask the runner status and the console setup state", async () => {
  const { remote, attach, hasSetup } = remoteFixture();
  create(remote);
  vi.mocked(RunnerService.prototype.status).mockResolvedValue(
    opaque("runner status"),
  );

  const [hooks] = attach.mock.calls[0];
  await expect(hooks.runnerStatus("connection-1")).resolves.toEqual(
    opaque("runner status"),
  );
  expect(vi.mocked(RunnerService.prototype.status)).toHaveBeenCalledWith(
    "connection-1",
  );
  expect(hooks.isSetupRunning("connection-2")).toBe(true);
  expect(hasSetup).toHaveBeenCalledWith("connection-2");
});

it.each(["", "   "])(
  "has no public runner address for the blank value %j",
  (configured) => {
    vi.stubEnv("PAGES_RUNNER_PUBLIC_URL", configured);

    create();

    expect(vi.mocked(RemoteSetupService).mock.calls[0][0].publicUrl).toBe(null);
  },
);

it.each(["https://pages.example.org", " http://pages.example.org:8443/ "])(
  "keeps only the origin of the public runner address %j",
  (configured) => {
    vi.stubEnv("PAGES_RUNNER_PUBLIC_URL", configured);

    create();

    expect(vi.mocked(RemoteSetupService).mock.calls[0][0].publicUrl).toBe(
      new URL(configured.trim()).origin,
    );
  },
);

it.each([
  "ftp://pages.example.org",
  "https://user@pages.example.org",
  "https://:secret@pages.example.org",
  "https://pages.example.org/pages",
  "https://pages.example.org/?token=1",
  "https://pages.example.org/#fragment",
])("refuses the public runner address %j", (configured) => {
  vi.stubEnv("PAGES_RUNNER_PUBLIC_URL", configured);

  expect(() => create()).toThrow("Invalid PAGES_RUNNER_PUBLIC_URL");
});
