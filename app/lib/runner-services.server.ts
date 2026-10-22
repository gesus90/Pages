import { AgentPlanAccess } from "@/backend/service/agents/AgentPlanAccess";
import { AgentPlanSharing } from "@/backend/service/agents/AgentPlanSharing";
import { AgentPlanRemoteTargets } from "@/backend/service/agents/AgentPlanRemoteTargets";
import { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { RunnerPlanEventRepository } from "@/backend/database/repositories/runner/RunnerPlanEventRepository";
import { RunnerPlanEventService } from "@/backend/service/runner/RunnerPlanEventService";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { RunnerRepository } from "@/backend/database/repositories/runner/RunnerRepository";
import { RunnerDeployKeyRepository } from "@/backend/database/repositories/runner/RunnerDeployKeyRepository";
import { RunnerService } from "@/backend/service/runner/RunnerService";
import { RunnerOpenRouterService } from "@/backend/service/runner/RunnerOpenRouterService";
import { RunnerSetupService } from "@/backend/service/runner/RunnerSetupService";
import { RemoteSetupService } from "@/backend/service/remote/setup/RemoteSetupService";
import { RunnerDeployKeyService } from "@/backend/service/runner/RunnerDeployKeyService";
import { RunnerGitHubContext } from "@/backend/service/runner/RunnerGitHubContext";
import { OfflineRunnerGitHubClient } from "@/backend/service/runner/OfflineRunnerGitHubClient";
import { HttpRunnerGitHubClient } from "@/backend/service/runner/HttpRunnerGitHubClient";

import type { Database } from "@/backend/database/Database";
import type { AgentConfigurationApplicationServices } from "./agent-workspace-services.server";
import type { RemoteApplicationServices } from "./remote-services.server";

/** Server-only runner configuration; offline GitHub is the default production behavior. */
export interface RunnerApplicationServices {
  readonly runnerGitHubMode: "offline" | "http";
  readonly runnerService: RunnerService;
  readonly runnerOpenRouterService: RunnerOpenRouterService;
  readonly runnerSetupService: RunnerSetupService;
  readonly remoteSetupService: RemoteSetupService;
  readonly runnerDeployKeyService: RunnerDeployKeyService;
}

/** The operator's address of Pages for runners; an origin only, so no path or secret can ride along. */
function readPublicUrl(): string | null {
  const configured = process.env.PAGES_RUNNER_PUBLIC_URL?.trim();
  if (!configured) return null;
  const address = new URL(configured);
  if (
    !["http:", "https:"].includes(address.protocol) ||
    address.username ||
    address.password ||
    address.pathname !== "/" ||
    address.search ||
    address.hash
  )
    throw new Error("Invalid PAGES_RUNNER_PUBLIC_URL");
  return address.origin;
}

/** Creates lazy clients; only an explicit http configuration can ever contact GitHub. */
export function createRunnerServices(input: {
  readonly database: Database;
  readonly remote: RemoteApplicationServices;
  readonly tokenKey: Buffer;
  readonly configuration: Pick<
    AgentConfigurationApplicationServices,
    "agentWorkspaceService" | "agentProfileService"
  >;
}): RunnerApplicationServices {
  const { database, remote, tokenKey } = input;
  const { agentWorkspaceService: workspaces, agentProfileService: profiles } =
    input.configuration;
  const mode = process.env.PAGES_RUNNER_GITHUB_MODE ?? "offline";
  if (mode !== "offline" && mode !== "http")
    throw new Error("Invalid runner GitHub mode");
  const context = new RunnerGitHubContext(
    new ProjectRepository(database),
    tokenKey,
  );
  const github =
    mode === "http"
      ? new HttpRunnerGitHubClient(context)
      : new OfflineRunnerGitHubClient(
          new RunnerDeployKeyRepository(database),
          context,
        );
  const runnerService = new RunnerService(
    new RunnerRepository(database),
    remote.remoteConnectionService,
    new RunnerPlanEventService(new RunnerPlanEventRepository(database), {
      plans: new AgentPlanAccess(
        new AgentPlanRepository(database),
        workspaces,
        new AgentPlanSharing(
          new AuthorizationRepository(database),
          new UserGroupRepository(database),
        ),
      ),
      runs: new AgentPlanRunRepository(database),
      profiles,
      targets: new AgentPlanRemoteTargets(
        remote.remoteWorkspaceService,
        remote.remoteConnectionService,
      ),
    }),
  );
  const runnerSetupService = new RunnerSetupService({
    runners: runnerService,
    connections: remote.remoteConnectionService,
    sessions: remote.remoteSessions,
    directory: process.env.PAGES_RUNNER_SETUP_DIRECTORY,
  });
  const remoteSetupService = new RemoteSetupService({
    connections: remote.remoteConnectionService,
    runners: runnerService,
    delivery: runnerSetupService,
    sessions: remote.remoteSessions,
    install: remote.remoteInstallService,
    publicUrl: readPublicUrl(),
  });
  // The console and the findings are built before the runner services they depend on.
  remote.remoteConsoleService.attachSetup(remoteSetupService);
  remote.remoteInstallService.attach({
    runnerStatus: (connectionId) => runnerService.status(connectionId),
    isSetupRunning: (connectionId) =>
      remote.remoteConsoleService.hasSetup(connectionId),
  });
  return {
    runnerService,
    runnerOpenRouterService: new RunnerOpenRouterService(runnerService),
    runnerGitHubMode: mode,
    runnerDeployKeyService: new RunnerDeployKeyService(github, workspaces),
    runnerSetupService,
    remoteSetupService,
  };
}
