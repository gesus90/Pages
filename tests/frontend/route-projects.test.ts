import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:crypto", () => ({ randomUUID: vi.fn(() => "project-1") }));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { ProjectManagementDeniedError } from "@/backend/service/ProjectService";
import { ProjectNotFoundError } from "@/backend/service/ProjectService";
import { action, loader } from "@/app/routes/projects";
import { ROLE } from "@/definition/Role";

import type { Project } from "@/definition/Project";
import type { User } from "@/definition/User";

const mockedServices = vi.mocked(getApplicationServices);

function createUser(): User {
  return {
    displayName: "Admin",
    id: "user-1",
    isActive: true,
    role: ROLE.ADMIN,
    username: "admin",
  };
}

function createProject(overrides: Partial<Project> = {}): Project {
  return {
    createdAt: "2026-01-01",
    description: "New public website",
    hasIcon: false,
    id: "project-1",
    managerId: null,
    managerName: null,
    name: "Website refresh",
    notes: "",
    parentId: null,
    placeholderColor: "#FCE3D3",
    progress: 20,
    startDate: null,
    status: "active",
    targetDate: null,
    updatedAt: "2026-01-02",
    ...overrides,
  };
}

function createServices(
  overrides: Record<string, unknown> = {},
): Awaited<ReturnType<typeof mockedServices>> {
  return {
    projectService: {
      archive: vi.fn(),
      canManageProjects: vi.fn().mockReturnValue(true),
      create: vi.fn(),
      findAll: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
    },
    ...overrides,
  } as unknown as Awaited<ReturnType<typeof mockedServices>>;
}

function createPostRequest(
  entries: Readonly<Record<string, string | undefined>>,
): Request {
  const formData = new URLSearchParams();

  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined) {
      formData.append(key, value);
    }
  }

  return new Request("http://pages.invalid/projekte", {
    body: formData,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
}

function getActionData(result: unknown): {
  data: Record<string, unknown>;
  init?: { status?: number };
} {
  return result as {
    data: Record<string, unknown>;
    init?: { status?: number };
  };
}

describe("projects route loader", () => {
  beforeEach(() => {
    mockedServices.mockReset();
  });

  it("loads projects without any selection state", async () => {
    const findAll = vi.fn().mockResolvedValue([createProject()]);
    const canManageProjects = vi.fn().mockReturnValue(true);
    mockedServices.mockResolvedValue(
      createServices({ projectService: { canManageProjects, findAll } }),
    );
    const context = { get: vi.fn().mockReturnValue(createUser()) };

    const result = await loader({
      context,
      params: {},
    } as unknown as Parameters<typeof loader>[0]);

    expect(result).toEqual({
      canManageProjects: true,
      projects: [createProject()],
    });
    expect(context.get).toHaveBeenCalledWith(authenticatedUserContext);
  });

  it("rejects calls missing authenticated middleware", async () => {
    await expect(
      loader({
        context: { get: vi.fn().mockReturnValue(null) },
        params: {},
      } as unknown as Parameters<typeof loader>[0]),
    ).rejects.toThrow("Authenticated middleware did not provide a user.");
  });
});

describe("projects route action", () => {
  beforeEach(() => {
    mockedServices.mockReset();
  });

  it("rejects methods other than POST and anonymous actors", async () => {
    const methodFailure = await action({
      context: { get: vi.fn().mockReturnValue(createUser()) },
      params: {},
      request: new Request("http://pages.invalid/projekte"),
    } as unknown as Parameters<typeof action>[0]).catch(
      (error: unknown) => error,
    );
    const anonymousFailure = await action({
      context: { get: vi.fn().mockReturnValue(null) },
      params: {},
      request: createPostRequest({ intent: "create-project" }),
    } as unknown as Parameters<typeof action>[0]).catch(
      (error: unknown) => error,
    );

    expect(methodFailure).toMatchObject({ status: 405 });
    expect((methodFailure as Response).headers.get("Allow")).toBe("POST");
    expect(anonymousFailure).toMatchObject({ status: 403 });
  });

  it("creates projects with normalized input and a deterministic color", async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    mockedServices.mockResolvedValue(
      createServices({ projectService: { create } }),
    );
    const actor = createUser();

    const result = getActionData(
      await action({
        context: { get: vi.fn().mockReturnValue(actor) },
        params: {},
        request: createPostRequest({
          description: "  New public website  ",
          intent: "create-project",
          name: "  Website refresh ",
          status: "planned",
        }),
      } as unknown as Parameters<typeof action>[0]),
    );

    expect(result.data).toEqual({
      intent: "create-project",
      ok: true,
      projectId: "project-1",
    });
    expect(create).toHaveBeenCalledWith(actor, {
      description: "New public website",
      id: "project-1",
      name: "Website refresh",
      ownerId: "user-1",
      placeholderColor: "#EEE4F8",
      status: "planned",
    });
  });

  it.each([
    [
      "create-project",
      { description: "Description", name: "", status: "planned" },
    ],
    [
      "create-project",
      { description: "Description", name: "Name", status: "archived" },
    ],
    ["unknown", {}],
  ])("rejects invalid %s input", async (intent, entries) => {
    mockedServices.mockResolvedValue(createServices());

    const result = getActionData(
      await action({
        context: { get: vi.fn().mockReturnValue(createUser()) },
        params: {},
        request: createPostRequest({ intent, ...entries }),
      } as unknown as Parameters<typeof action>[0]),
    );

    expect(result.init?.status).toBe(400);
    expect(result.data).toMatchObject({ error: "invalidInput", ok: false });
  });

  it("rejects names and descriptions beyond the limits", async () => {
    mockedServices.mockResolvedValue(createServices());

    for (const entries of [
      {
        description: "Description",
        intent: "create-project",
        name: "a".repeat(201),
        status: "planned",
      },
      {
        description: "a".repeat(10_001),
        intent: "create-project",
        name: "Name",
        status: "planned",
      },
    ]) {
      const result = getActionData(
        await action({
          context: { get: vi.fn().mockReturnValue(createUser()) },
          params: {},
          request: createPostRequest(entries),
        } as unknown as Parameters<typeof action>[0]),
      );

      expect(result.init?.status).toBe(400);
    }
  });

  it("maps create-project service errors", async () => {
    mockedServices.mockResolvedValue(
      createServices({
        projectService: {
          create: vi.fn().mockRejectedValue(new ProjectManagementDeniedError()),
        },
      }),
    );

    const result = getActionData(
      await action({
        context: { get: vi.fn().mockReturnValue(createUser()) },
        params: {},
        request: createPostRequest({
          description: "Description",
          intent: "create-project",
          name: "Name",
          status: "planned",
        }),
      } as unknown as Parameters<typeof action>[0]),
    );

    expect(result.init?.status).toBe(403);
    expect(result.data).toMatchObject({
      error: "forbidden",
      intent: "create-project",
      ok: false,
    });
  });

  it("maps missing projects to a 404 response", async () => {
    mockedServices.mockResolvedValue(
      createServices({
        projectService: {
          create: vi.fn().mockRejectedValue(new ProjectNotFoundError()),
        },
      }),
    );

    const result = getActionData(
      await action({
        context: { get: vi.fn().mockReturnValue(createUser()) },
        params: {},
        request: createPostRequest({
          description: "Description",
          intent: "create-project",
          name: "Name",
          status: "planned",
        }),
      } as unknown as Parameters<typeof action>[0]),
    );

    expect(result.init?.status).toBe(404);
    expect(result.data).toMatchObject({
      error: "projectNotFound",
      intent: "create-project",
      ok: false,
    });
  });

  it("propagates unexpected service failures", async () => {
    mockedServices.mockResolvedValue(
      createServices({
        projectService: {
          create: vi.fn().mockRejectedValue(new Error("Disk failed")),
        },
      }),
    );

    await expect(
      action({
        context: { get: vi.fn().mockReturnValue(createUser()) },
        params: {},
        request: createPostRequest({
          description: "Description",
          intent: "create-project",
          name: "Name",
          status: "planned",
        }),
      } as unknown as Parameters<typeof action>[0]),
    ).rejects.toThrow("Disk failed");
  });
});
