import { beforeEach, expect, it, vi } from "vitest";

import { createPlanWorkspaceAccess } from "@/app/lib/plan-access-services.server";
import { AgentPlanAccess } from "@/backend/service/agents/AgentPlanAccess";
import { AgentPlanSharing } from "@/backend/service/agents/AgentPlanSharing";
import { AgentPlanWorkspaces } from "@/backend/service/agents/AgentPlanWorkspaces";
import { AgentPlanWorkspaceRepository } from "@/backend/database/repositories/agent/AgentPlanWorkspaceRepository";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";

import type { Database } from "@/backend/database/Database";
import type { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import type { AgentWorkspaceService } from "@/backend/service/agents/AgentWorkspaceService";
import type { RemoteWorkspaceService } from "@/backend/service/remote/RemoteWorkspaceService";

const { fakeClasses, opaque } = await vi.hoisted(
  async () => import("./service-wiring-fakes"),
);

vi.mock("@/backend/service/agents/AgentPlanAccess", () =>
  fakeClasses({ AgentPlanAccess: [] }),
);
vi.mock("@/backend/service/agents/AgentPlanSharing", () =>
  fakeClasses({ AgentPlanSharing: [] }),
);
vi.mock("@/backend/service/agents/AgentPlanWorkspaces", () =>
  fakeClasses({ AgentPlanWorkspaces: [] }),
);
vi.mock(
  "@/backend/database/repositories/agent/AgentPlanWorkspaceRepository",
  () => fakeClasses({ AgentPlanWorkspaceRepository: [] }),
);
vi.mock("@/backend/database/repositories/AuthorizationRepository", () =>
  fakeClasses({ AuthorizationRepository: [] }),
);
vi.mock("@/backend/database/repositories/UserGroupRepository", () =>
  fakeClasses({ UserGroupRepository: [] }),
);
vi.mock("@/backend/database/repositories/ProjectRepository", () =>
  fakeClasses({ ProjectRepository: [] }),
);

const DATABASE = opaque<Database>("database");
const PLANS = opaque<AgentPlanRepository>("plans");
const LOCAL = opaque<AgentWorkspaceService>("local workspaces");
const REMOTE = opaque<RemoteWorkspaceService>("remote workspaces");

beforeEach(() => {
  vi.resetAllMocks();
});

function createAccess(): ReturnType<typeof createPlanWorkspaceAccess> {
  return createPlanWorkspaceAccess(
    {
      database: DATABASE,
      agents: { agentWorkspaceService: LOCAL, remoteWorkspaceService: REMOTE },
    },
    PLANS,
  );
}

it("builds one workspace catalog over local, remote and registered workspaces", () => {
  const { workspaceCatalog } = createAccess();

  expect(workspaceCatalog).toBe(
    vi.mocked(AgentPlanWorkspaces).mock.instances[0],
  );
  expect(vi.mocked(AgentPlanWorkspaces).mock.calls).toEqual([
    [
      {
        local: LOCAL,
        remote: REMOTE,
        registrations: vi.mocked(AgentPlanWorkspaceRepository).mock
          .instances[0],
        projects: vi.mocked(ProjectRepository).mock.instances[0],
      },
    ],
  ]);
  expect(vi.mocked(AgentPlanWorkspaceRepository).mock.calls).toEqual([
    [DATABASE],
  ]);
  expect(vi.mocked(ProjectRepository).mock.calls).toEqual([[DATABASE]]);
});

it("checks plan access with team sharing and the same workspace catalog", () => {
  const { access, workspaceCatalog } = createAccess();

  expect(access).toBe(vi.mocked(AgentPlanAccess).mock.instances[0]);
  const [plans, local, sharing, catalog] =
    vi.mocked(AgentPlanAccess).mock.calls[0];
  expect(plans).toBe(PLANS);
  expect(local).toBe(LOCAL);
  expect(sharing).toBe(vi.mocked(AgentPlanSharing).mock.instances[0]);
  expect(catalog).toBe(workspaceCatalog);
  expect(vi.mocked(AgentPlanSharing).mock.calls[0]).toEqual([
    vi.mocked(AuthorizationRepository).mock.instances[0],
    vi.mocked(UserGroupRepository).mock.instances[0],
  ]);
  expect(vi.mocked(AuthorizationRepository).mock.calls).toEqual([[DATABASE]]);
  expect(vi.mocked(UserGroupRepository).mock.calls).toEqual([[DATABASE]]);
});
