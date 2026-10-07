import { beforeEach, describe, expect, it, vi } from "vitest";
import { RouterContextProvider } from "react-router";

vi.mock("node:crypto", () => ({ randomUUID: vi.fn(() => "project-1") }));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { action, loader } from "@/app/routes/projects";

import { createUser } from "../helpers/factories";
import {
  ProjectManagementDeniedError,
  ProjectAccessDeniedError,
  ProjectDepartmentError,
  ProjectNotFoundError,
} from "@/backend/error/ProjectErrors";

import type { Project } from "@/definition/Project";

const mockedServices = vi.mocked(getApplicationServices);

function createProject(overrides: Partial<Project> = {}): Project {
  return {
    createdAt: "2026-01-01",
    description: "New public website",
    departments: [],
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
      findArchived: vi.fn().mockResolvedValue([]),
      canDeleteProjects: vi.fn().mockResolvedValue(false),
      canCreateProjects: vi.fn().mockResolvedValue(true),
      departmentChoices: vi
        .fn()
        .mockResolvedValue({ available: [], selectionRequired: false }),
      create: vi.fn(),
      findAll: vi.fn().mockResolvedValue([]),
      findTemplates: vi.fn().mockResolvedValue([]),
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

/** Builds a real authenticated request context for the template route cases. */
function templateActionArgs(request: Request): Parameters<typeof action>[0] {
  const context = new RouterContextProvider();
  context.set(authenticatedUserContext, createUser());
  return {
    context,
    params: {},
    request,
    url: new URL(request.url),
    pattern: "/projekte",
  };
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
      createServices({
        projectService: {
          canCreateProjects: canManageProjects,
          findArchived: vi.fn().mockResolvedValue([]),
          canDeleteProjects: vi.fn().mockResolvedValue(false),
          findAll,
          findTemplates: vi.fn().mockResolvedValue([]),
          departmentChoices: vi
            .fn()
            .mockResolvedValue({ available: [], selectionRequired: false }),
        },
      }),
    );
    const context = { get: vi.fn().mockReturnValue(createUser()) };

    const result = await loader({
      context,
      params: {},
    } as unknown as Parameters<typeof loader>[0]);

    expect(result).toEqual({
      canManageProjects: true,
      archivedProjects: [],
      canDeleteProjects: false,
      departmentChoices: { available: [], selectionRequired: false },
      projects: [createProject()],
      templates: [],
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
      departmentIds: [],
      id: "project-1",
      name: "Website refresh",
      ownerId: "user-1",
      placeholderColor: "#EEE4F8",
      status: "planned",
    });
  });

  it("uses a selected template and reports creation without subsequent read access", async () => {
    const createFromTemplate = vi.fn().mockResolvedValue(false);
    mockedServices.mockResolvedValue(
      createServices({ projectService: { createFromTemplate } }),
    );
    const result = getActionData(
      await action(
        templateActionArgs(
          createPostRequest({
            intent: "create-project",
            name: "New name",
            description: "",
            status: "active",
            templateId: "template",
          }),
        ),
      ),
    );
    expect(createFromTemplate).toHaveBeenCalledWith(
      createUser(),
      "template",
      expect.objectContaining({ name: "New name", departmentIds: [] }),
    );
    expect(result.data).toMatchObject({ ok: true, canOpen: false });
  });

  it("rejects template files and current source access denial", async () => {
    const createFromTemplate = vi
      .fn()
      .mockRejectedValue(new ProjectAccessDeniedError());
    const services = createServices({ projectService: { createFromTemplate } });
    mockedServices.mockResolvedValue(services);
    const form = new FormData();
    for (const [key, value] of Object.entries({
      intent: "create-project",
      name: "New name",
      description: "",
      status: "planned",
    }))
      form.set(key, value);
    form.set("templateId", new Blob(["invalid"]), "invalid.txt");
    const request = new Request("http://pages.invalid/projekte", {
      method: "POST",
      body: form,
    });
    expect(
      getActionData(await action(templateActionArgs(request))).init?.status,
    ).toBe(400);
    expect(createFromTemplate).not.toHaveBeenCalled();
    const result = getActionData(
      await action(
        templateActionArgs(
          createPostRequest({
            intent: "create-project",
            name: "New name",
            description: "",
            status: "planned",
            templateId: "template",
          }),
        ),
      ),
    );
    expect(result.init?.status).toBe(403);
    expect(result.data).toMatchObject({ error: "forbidden" });
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

  it.each([
    ["departmentRequired", 400],
    ["invalidDepartment", 400],
    ["departmentOutOfScope", 403],
  ] as const)("maps department selection error %s", async (code, status) => {
    mockedServices.mockResolvedValue(
      createServices({
        projectService: {
          create: vi.fn().mockRejectedValue(new ProjectDepartmentError(code)),
        },
      }),
    );
    const result = getActionData(
      await action({
        context: { get: vi.fn().mockReturnValue(createUser()) },
        params: {},
        request: createPostRequest({
          intent: "create-project",
          name: "Name",
          description: "",
          status: "planned",
        }),
      } as unknown as Parameters<typeof action>[0]),
    );
    expect(result.init?.status).toBe(status);
    expect(result.data).toMatchObject({ ok: false, error: code });
  });

  it("reads repeated department IDs and rejects file values", async () => {
    const create = vi.fn();
    mockedServices.mockResolvedValue(
      createServices({ projectService: { create } }),
    );
    const form = new FormData();
    for (const [key, value] of Object.entries({
      intent: "create-project",
      name: "Name",
      description: "",
      status: "planned",
    }))
      form.set(key, value);
    form.append("departmentIds", "frontend");
    form.append("departmentIds", "backend");
    const args = {
      context: { get: vi.fn().mockReturnValue(createUser()) },
      params: {},
    };
    await action({
      ...args,
      request: new Request("http://pages.invalid/projekte", {
        method: "POST",
        body: form,
      }),
    } as unknown as Parameters<typeof action>[0]);
    expect(create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ departmentIds: ["frontend", "backend"] }),
    );
    create.mockClear();
    form.append("departmentIds", new Blob(["invalid"]), "invalid.txt");
    const result = getActionData(
      await action({
        ...args,
        request: new Request("http://pages.invalid/projekte", {
          method: "POST",
          body: form,
        }),
      } as unknown as Parameters<typeof action>[0]),
    );
    expect(result.init?.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
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
