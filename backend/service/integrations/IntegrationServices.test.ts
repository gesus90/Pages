import { describe, expect, it, vi } from "vitest";

import type { Mock } from "vitest";

const made = vi.hoisted<{
  github: unknown;
  setDescriptionAssets: Mock;
  getContext: Mock;
  permissionLookup: unknown;
}>(() => ({
  github: null,
  setDescriptionAssets: vi.fn(),
  getContext: vi.fn(async () => "context"),
  permissionLookup: null,
}));

function stub(name: string): Record<string, Mock> {
  return {
    [name]: vi.fn(function (this: object) {
      Object.assign(this, { name });
    }),
  };
}

vi.mock(
  "@/backend/database/repositories/integrations/GitHubCreationRepository",
  () => stub("GitHubCreationRepository"),
);
vi.mock("@/backend/auth/PermissionService", () => ({
  PermissionService: vi.fn(function (this: object, lookup: unknown) {
    made.permissionLookup = lookup;
  }),
}));
vi.mock("@/backend/auth/PasswordHasher", () => stub("PasswordHasher"));
vi.mock("@/backend/cache/ServerCache", () => ({
  ServerCache: { disabled: () => "cache" },
}));
vi.mock("@/backend/database/repositories/AuthorizationRepository", () =>
  stub("AuthorizationRepository"),
);
vi.mock("@/backend/database/repositories/GitHubRepository", () =>
  stub("GitHubRepository"),
);
vi.mock("@/backend/database/repositories/ProjectRepository", () =>
  stub("ProjectRepository"),
);
vi.mock("@/backend/database/repositories/TaskRepository", () =>
  stub("TaskRepository"),
);
vi.mock("@/backend/database/repositories/UserRepository", () =>
  stub("UserRepository"),
);
vi.mock("@/backend/database/repositories/WikiRepository", () =>
  stub("WikiRepository"),
);
vi.mock(
  "@/backend/database/repositories/task/WorkItemAttachmentRepository",
  () => stub("WorkItemAttachmentRepository"),
);
vi.mock("@/backend/database/repositories/agents/AgentAssetRepository", () =>
  stub("AgentAssetRepository"),
);
vi.mock("@/backend/service/AdministrationService", () => ({
  AdministrationService: vi.fn(function (this: object) {
    Object.assign(this, { getContext: made.getContext });
  }),
}));
vi.mock("@/backend/service/GitHubSyncService", () => ({
  GitHubSyncService: vi.fn(function (this: object, input: unknown) {
    made.github = input;
  }),
}));
vi.mock("@/backend/service/ProjectService", () => stub("ProjectService"));
vi.mock("@/backend/service/task/TaskDescriptionAssetService", () =>
  stub("TaskDescriptionAssetService"),
);
vi.mock("@/backend/service/TaskService", () => ({
  TaskService: vi.fn(function (this: object) {
    Object.assign(this, { setDescriptionAssets: made.setDescriptionAssets });
  }),
}));
vi.mock("@/backend/service/task/TaskAttachmentService", () =>
  stub("TaskAttachmentService"),
);
vi.mock("@/backend/service/UserService", () => stub("UserService"));
vi.mock("@/backend/service/WikiService", () => stub("WikiService"));
vi.mock("@/backend/service/agents/AgentAssetService", () =>
  stub("AgentAssetService"),
);
vi.mock("@/backend/storage/TicketFileStore", () => stub("TicketFileStore"));
vi.mock("@/backend/storage/WikiFileStore", () => stub("WikiFileStore"));

import { createIntegrationServices } from "./IntegrationServices";

describe("createIntegrationServices", () => {
  it("builds the integration service set", async () => {
    const events = { announce: vi.fn() };
    const services = createIntegrationServices(
      {} as unknown as never,
      "data",
      Buffer.alloc(32),
      { events },
    );
    expect(Object.keys(services.ticketAssets).sort()).toEqual([
      "assets",
      "tickets",
      "wiki",
    ]);
    expect(services.github).toBeDefined();
    expect(made.setDescriptionAssets).toHaveBeenCalledTimes(1);
    expect((made.github as { events: unknown }).events).toBe(events);
    await (made.permissionLookup as (id: string) => Promise<string>)("u1");
    expect(made.getContext).toHaveBeenCalledWith("u1");
  });
});
