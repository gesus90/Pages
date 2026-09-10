import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  ProjectAccessDeniedError,
  ProjectManagementDeniedError,
  ProjectNotFoundError,
} from "@/backend/service/ProjectService";
import { action, loader } from "@/app/routes/project-icon";
import { ROLE } from "@/definition/Role";

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

function createContext(user: User | null): { get: ReturnType<typeof vi.fn> } {
  return { get: vi.fn().mockReturnValue(user) };
}

function createServices(
  overrides: Record<string, unknown> = {},
): Awaited<ReturnType<typeof mockedServices>> {
  return {
    projectService: {
      getIcon: vi.fn(),
      replaceIcon: vi.fn(),
    },
    ...overrides,
  } as unknown as Awaited<ReturnType<typeof mockedServices>>;
}

function createActionRequest(icon: File | null): Request {
  const formData = new FormData();

  if (icon) {
    formData.append("icon", icon);
  }

  return new Request("http://pages.invalid/projekte/project-1/icon", {
    body: formData,
    method: "POST",
  });
}

async function getFailure(promise: Promise<unknown>): Promise<Response> {
  try {
    await promise;
  } catch (error: unknown) {
    if (!(error instanceof Response)) {
      throw error;
    }

    return error;
  }

  throw new Error("Expected route to throw a response.");
}

describe("project icon loader", () => {
  beforeEach(() => {
    mockedServices.mockReset();
  });

  it("returns stored icons as private image responses", async () => {
    const getIcon = vi.fn().mockResolvedValue({
      data: Buffer.from([1, 2, 3]),
      filename: "logo.png",
      mimeType: "image/png",
    });
    mockedServices.mockResolvedValue(
      createServices({ projectService: { getIcon } }),
    );
    const context = createContext(createUser());

    const response = await loader({
      context,
      params: { projectId: "project-1" },
      request: new Request("http://pages.invalid/projekte/project-1/icon"),
    } as unknown as Parameters<typeof loader>[0]);

    expect(response.headers.get("Cache-Control")).toBe("private, max-age=300");
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(await response.bytes()).toEqual(new Uint8Array([1, 2, 3]));
    expect(context.get).toHaveBeenCalledWith(authenticatedUserContext);
  });

  it.each([
    ["POST", { Allow: "GET" }],
    ["PUT", { Allow: "GET" }],
  ])("rejects %s icon reads", async (method, headers) => {
    const failure = await getFailure(
      loader({
        context: createContext(createUser()),
        params: { projectId: "project-1" },
        request: new Request("http://pages.invalid/projekte/project-1/icon", {
          method,
        }),
      } as unknown as Parameters<typeof loader>[0]),
    );

    expect(failure.status).toBe(405);
    expect(failure.headers.get("Allow")).toBe(headers.Allow);
  });

  it("rejects missing actors and project identifiers", async () => {
    mockedServices.mockResolvedValue(createServices());

    const anonymousFailure = await getFailure(
      loader({
        context: createContext(null),
        params: { projectId: "project-1" },
        request: new Request("http://pages.invalid/projekte/project-1/icon"),
      } as unknown as Parameters<typeof loader>[0]),
    );
    const missingIdFailure = await getFailure(
      loader({
        context: createContext(createUser()),
        params: {},
        request: new Request("http://pages.invalid/projekte/icon"),
      } as unknown as Parameters<typeof loader>[0]),
    );

    expect(anonymousFailure.status).toBe(403);
    expect(missingIdFailure.status).toBe(404);
  });

  it("maps missing, inaccessible, and absent icons to responses", async () => {
    const getIcon = vi
      .fn()
      .mockRejectedValueOnce(new ProjectNotFoundError())
      .mockRejectedValueOnce(new ProjectAccessDeniedError())
      .mockResolvedValueOnce(null);
    mockedServices.mockResolvedValue(
      createServices({ projectService: { getIcon } }),
    );
    const argumentsForLoader = {
      context: createContext(createUser()),
      params: { projectId: "project-1" },
      request: new Request("http://pages.invalid/projekte/project-1/icon"),
    } as unknown as Parameters<typeof loader>[0];

    await expect(getFailure(loader(argumentsForLoader))).resolves.toMatchObject(
      { status: 404 },
    );
    await expect(getFailure(loader(argumentsForLoader))).resolves.toMatchObject(
      { status: 403 },
    );
    await expect(getFailure(loader(argumentsForLoader))).resolves.toMatchObject(
      { status: 404 },
    );
  });

  it("propagates unexpected icon read failures", async () => {
    mockedServices.mockResolvedValue(
      createServices({
        projectService: {
          getIcon: vi.fn().mockRejectedValue(new Error("Disk failed")),
        },
      }),
    );

    await expect(
      loader({
        context: createContext(createUser()),
        params: { projectId: "project-1" },
        request: new Request("http://pages.invalid/projekte/project-1/icon"),
      } as unknown as Parameters<typeof loader>[0]),
    ).rejects.toThrow("Disk failed");
  });
});

describe("project icon action", () => {
  beforeEach(() => {
    mockedServices.mockReset();
  });

  it("stores valid images and redirects to their project", async () => {
    const replaceIcon = vi.fn().mockResolvedValue(undefined);
    mockedServices.mockResolvedValue(
      createServices({ projectService: { replaceIcon } }),
    );
    const icon = new File([new Uint8Array([1, 2])], "logo.png", {
      type: "image/png",
    });

    const response = await action({
      context: createContext(createUser()),
      params: { projectId: "project 1" },
      request: createActionRequest(icon),
    } as unknown as Parameters<typeof action>[0]);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/projekte/project%201");
    expect(replaceIcon).toHaveBeenCalledWith(createUser(), "project 1", {
      data: Buffer.from([1, 2]),
      filename: "logo.png",
      mimeType: "image/png",
    });
  });

  it("uses a default filename when the uploaded image has no name", async () => {
    const replaceIcon = vi.fn().mockResolvedValue(undefined);
    mockedServices.mockResolvedValue(
      createServices({ projectService: { replaceIcon } }),
    );
    const boundary = "pages-test-boundary";
    const request = new Request(
      "http://pages.invalid/projekte/project-1/icon",
      {
        body: [
          `--${boundary}`,
          'Content-Disposition: form-data; name="icon"; filename=""',
          "Content-Type: image/png",
          "",
          "x",
          `--${boundary}--`,
          "",
        ].join("\r\n"),
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        method: "POST",
      },
    );

    await action({
      context: createContext(createUser()),
      params: { projectId: "project-1" },
      request,
    } as unknown as Parameters<typeof action>[0]);

    expect(replaceIcon).toHaveBeenCalledWith(
      createUser(),
      "project-1",
      expect.objectContaining({ filename: "project-icon" }),
    );
  });

  it.each([
    [null, 400],
    [new File(["svg"], "logo.svg", { type: "image/svg+xml" }), 400],
    [new File([], "empty.png", { type: "image/png" }), 400],
    [
      new File([new Uint8Array(2 * 1024 * 1024 + 1)], "large.png", {
        type: "image/png",
      }),
      400,
    ],
  ])("rejects invalid upload %p", async (icon, status) => {
    const failure = await getFailure(
      action({
        context: createContext(createUser()),
        params: { projectId: "project-1" },
        request: createActionRequest(icon),
      } as unknown as Parameters<typeof action>[0]),
    );

    expect(failure.status).toBe(status);
  });

  it("rejects invalid methods and missing project identifiers", async () => {
    const methodFailure = await getFailure(
      action({
        context: createContext(createUser()),
        params: { projectId: "project-1" },
        request: new Request("http://pages.invalid/projekte/project-1/icon"),
      } as unknown as Parameters<typeof action>[0]),
    );
    const missingIdFailure = await getFailure(
      action({
        context: createContext(createUser()),
        params: {},
        request: createActionRequest(
          new File(["image"], "logo.png", { type: "image/png" }),
        ),
      } as unknown as Parameters<typeof action>[0]),
    );

    expect(methodFailure).toMatchObject({ status: 405 });
    expect(methodFailure.headers.get("Allow")).toBe("POST");
    expect(missingIdFailure).toMatchObject({ status: 404 });
  });

  it("maps missing and denied icon replacement to responses", async () => {
    const replaceIcon = vi
      .fn()
      .mockRejectedValueOnce(new ProjectNotFoundError())
      .mockRejectedValueOnce(new ProjectAccessDeniedError())
      .mockRejectedValueOnce(new ProjectManagementDeniedError());
    mockedServices.mockResolvedValue(
      createServices({ projectService: { replaceIcon } }),
    );
    function createArguments(): Parameters<typeof action>[0] {
      return {
        context: createContext(createUser()),
        params: { projectId: "project-1" },
        request: createActionRequest(
          new File(["image"], "logo.png", { type: "image/png" }),
        ),
      } as unknown as Parameters<typeof action>[0];
    }

    await expect(getFailure(action(createArguments()))).resolves.toMatchObject({
      status: 404,
    });
    await expect(getFailure(action(createArguments()))).resolves.toMatchObject({
      status: 403,
    });
    await expect(getFailure(action(createArguments()))).resolves.toMatchObject({
      status: 403,
    });
  });

  it("propagates unexpected icon replacement failures", async () => {
    mockedServices.mockResolvedValue(
      createServices({
        projectService: {
          replaceIcon: vi.fn().mockRejectedValue(new Error("Disk failed")),
        },
      }),
    );

    await expect(
      action({
        context: createContext(createUser()),
        params: { projectId: "project-1" },
        request: createActionRequest(
          new File(["image"], "logo.png", { type: "image/png" }),
        ),
      } as unknown as Parameters<typeof action>[0]),
    ).rejects.toThrow("Disk failed");
  });
});
