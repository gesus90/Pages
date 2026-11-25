import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ProjectManagementDeniedError,
  ProjectNotFoundError,
} from "@/backend/error/ProjectErrors";
import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";

import {
  finishProjectDeletion,
  ProjectDeletionService,
} from "./ProjectDeletionService";

import type { ServerCache } from "@/backend/cache/ServerCache";
import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import type { ProjectDeletionFiles } from "@/backend/database/repositories/project/ProjectDeletionFiles";
import type { User } from "@/definition/User";

const policy = vi.hoisted(() => ({
  canDelete: vi.fn(() => true),
  canDeleteProject: vi.fn(() => true),
  account: vi.fn(async () => ({ userId: "u1" })),
}));

vi.mock("@/backend/auth/ProjectPolicyService", () => ({
  ProjectPolicyService: class {
    public canDelete = policy.canDelete;
    public canDeleteProject = policy.canDeleteProject;
  },
}));
vi.mock("./ProjectAccessService", () => ({
  ProjectAccessService: class {
    public account = policy.account;
  },
}));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logDiagnostic: vi.fn(),
}));

const actor = doubleOf<User>({ id: "u1" });
const files = { wikiAttachments: [] } as unknown as ProjectDeletionFiles;
const details = { memberIds: ["m"], scope: { name: "S" } };

type Mock = ReturnType<typeof vi.fn>;

function setup(
  facts: {
    active?: object | null;
    archived?: object | null;
    details?: object | null;
  } = {},
): {
  readonly service: ProjectDeletionService;
  readonly repository: Record<string, Mock>;
  readonly cache: Record<string, Mock>;
} {
  const repository: Record<string, Mock> = {
    findById: vi.fn(async () =>
      facts.active === undefined
        ? { departments: [{ id: "d" }] }
        : facts.active,
    ),
    findArchivedById: vi.fn(async () =>
      facts.archived === undefined ? null : facts.archived,
    ),
    describeDeletion: vi.fn(async () =>
      facts.details === undefined ? details : facts.details,
    ),
    deletePermanently: vi.fn(async () => files),
    appendEvent: vi.fn(async () => {}),
  };
  repository.transaction = vi.fn(async (work: (r: object) => unknown) =>
    work(repository),
  );
  const cache: Record<string, Mock> = {
    invalidateProject: vi.fn(),
    invalidateProjectMembership: vi.fn(),
    invalidateWorkItems: vi.fn(),
    invalidateLabels: vi.fn(),
    invalidateGitHub: vi.fn(),
    invalidatePrefix: vi.fn(),
  };
  const service = new ProjectDeletionService(
    repository as unknown as ProjectRepository,
    cache as unknown as ServerCache,
  );
  return { service, repository, cache };
}

beforeEach(() => {
  vi.clearAllMocks();
  policy.canDelete.mockReturnValue(true);
  policy.canDeleteProject.mockReturnValue(true);
});

describe("finishProjectDeletion", () => {
  it("invalidates caches and removes files", async () => {
    const { cache } = setup();
    const effects = { stopRuns: vi.fn(), removeFiles: vi.fn(async () => {}) };
    await finishProjectDeletion(
      cache as unknown as ServerCache,
      effects,
      "p",
      files,
    );
    expect(cache.invalidatePrefix).toHaveBeenCalledWith(
      "project:",
      "statuses:",
    );
    expect(effects.removeFiles).toHaveBeenCalledWith(files);
  });

  it("works without effects", async () => {
    const { cache } = setup();
    await finishProjectDeletion(
      cache as unknown as ServerCache,
      null,
      "p",
      files,
    );
    expect(logCaughtError).not.toHaveBeenCalled();
  });

  it("reports file problems without failing", async () => {
    const { cache } = setup();
    const effects = {
      stopRuns: vi.fn(),
      removeFiles: vi.fn(async () => {
        throw new Error("disk");
      }),
    };
    await finishProjectDeletion(
      cache as unknown as ServerCache,
      effects,
      "p",
      files,
    );
    expect(logCaughtError).toHaveBeenCalled();
    expect(logDiagnostic).toHaveBeenCalled();
  });
});

describe("ProjectDeletionService", () => {
  it("authorizes active and archived projects", async () => {
    await expect(
      setup().service.authorize(actor, "p"),
    ).resolves.toBeUndefined();
    const archived = setup({ active: null, archived: { departments: [] } });
    await expect(
      archived.service.authorize(actor, "p"),
    ).resolves.toBeUndefined();
  });

  it("refuses non-administrators, missing projects and out-of-reach projects", async () => {
    policy.canDelete.mockReturnValue(false);
    await expect(setup().service.authorize(actor, "p")).rejects.toBeInstanceOf(
      ProjectManagementDeniedError,
    );
    policy.canDelete.mockReturnValue(true);
    await expect(
      setup({ active: null }).service.authorize(actor, "p"),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
    policy.canDeleteProject.mockReturnValue(false);
    await expect(setup().service.authorize(actor, "p")).rejects.toBeInstanceOf(
      ProjectManagementDeniedError,
    );
  });

  it("describes the deletion", async () => {
    expect(await setup().service.describe(actor, "p")).toBe(details);
    await expect(
      setup({ details: null }).service.describe(actor, "p"),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it("deletes and appends the access event", async () => {
    const { service, repository } = setup();
    expect(await service.delete(actor, "p")).toEqual({
      files,
      memberIds: ["m"],
      scope: details.scope,
    });
    expect(repository.appendEvent).toHaveBeenCalledWith({
      type: "project.access.changed",
      id: "p",
    });
    await expect(
      setup({ details: null }).service.delete(actor, "p"),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it("stops runs before and removes files after the deletion", async () => {
    const { service, cache } = setup();
    const effects = {
      stopRuns: vi.fn(async () => {}),
      removeFiles: vi.fn(async () => {}),
    };
    const outcome = await service.deleteWithEffects(actor, "p", effects);
    expect(effects.stopRuns).toHaveBeenCalledWith("p");
    expect(effects.removeFiles).toHaveBeenCalledWith(files);
    expect(outcome.memberIds).toEqual(["m"]);
    expect(cache.invalidateProject).toHaveBeenCalledWith("p");
    await expect(
      setup().service.deleteWithEffects(actor, "p", null),
    ).resolves.toBeDefined();
  });
});

function doubleOf<Type>(value: unknown): Type {
  return value as Type;
}
