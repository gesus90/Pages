import { render, screen } from "@testing-library/react";
import {
  createMemoryRouter,
  RouterContextProvider,
  RouterProvider,
} from "react-router";
import { beforeEach, expect, it, vi } from "vitest";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { loadRemoteOverview } from "@/app/lib/remote-actions.server";
import AgentWorkspacesRoute, {
  action,
  ErrorBoundary,
  headers,
  loader,
  shouldRevalidate,
} from "@/app/routes/agent-workspaces";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { ShouldRevalidateFunctionArgs } from "react-router";
import type { RemoteOverview } from "@/definition/RemoteConnection";
import type { User } from "@/definition/User";

const services = vi.hoisted(() => ({
  agentWorkspaceService: {
    page: vi.fn(),
    usages: vi.fn(),
    save: vi.fn(),
    remove: vi.fn(),
  },
  settingsService: { getTerminalScreenReader: vi.fn() },
}));
vi.mock("@/app/lib/auth.server", async () => {
  const router = await import("react-router");
  return { authenticatedUserContext: router.createContext<User | null>(null) };
});
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async (): Promise<unknown> => services,
}));
vi.mock("@/app/lib/remote-actions.server", () => ({
  loadRemoteOverview: vi.fn(),
}));
vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));
vi.mock("@/app/components/agents/workspaces/workspace-page", () => ({
  WorkspacePage: (props: {
    readonly page: { readonly title: string };
    readonly remote: { readonly label: string };
  }): React.ReactElement => (
    <main>{`${props.page.title} ${props.remote.label}`}</main>
  ),
}));
vi.mock("@/app/components/agents/workspaces/workspace-load-error", () => ({
  WorkspaceLoadError: (): React.ReactElement => <p role="alert">Load failed</p>,
}));

const REMOTE: RemoteOverview = {
  canManageConnections: false,
  connections: [],
  departments: [],
  workspaces: [],
  choices: [],
  installs: {},
};
const USER: User = {
  id: "user-1",
  username: "ada",
  displayName: "Ada",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};

beforeEach(() => {
  for (const method of Object.values(services.agentWorkspaceService))
    method.mockReset();
  services.settingsService.getTerminalScreenReader.mockReset();
  vi.mocked(loadRemoteOverview).mockReset();
  vi.mocked(logCaughtError).mockReset();
});

/** The route arguments for a request of the given user. */
function routeArguments(
  request: Request,
  user: User | null,
): Parameters<typeof loader>[0] & Parameters<typeof action>[0] {
  const context = new RouterContextProvider();
  context.set(authenticatedUserContext, user);
  return {
    request,
    context,
    params: {},
    url: new URL(request.url),
    pattern: "/agents/workspaces",
  };
}

/** Posts a form of the given fields as the signed-in user. */
async function post(
  fields: Readonly<Record<string, string>>,
): Promise<{ readonly status: number; readonly body: unknown }> {
  const request = new Request("http://pages.invalid/agents/workspaces", {
    method: "POST",
    body: new URLSearchParams(fields),
  });
  const response = await action(routeArguments(request, USER));
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  return { status: response.status, body: await response.json() };
}

/** Runs the loader and returns the response it threw. */
async function thrownByLoader(user: User | null): Promise<Response> {
  try {
    await loader(
      routeArguments(
        new Request("http://pages.invalid/agents/workspaces"),
        user,
      ),
    );
  } catch (error: unknown) {
    if (error instanceof Response) return error;
    throw error;
  }
  throw new Error("Expected a thrown response.");
}

it("keeps the page out of browser and proxy caches", () => {
  const parentHeaders = new Headers({ "X-Parent": "1" });
  const result = new Headers(
    headers({
      parentHeaders,
      loaderHeaders: new Headers(),
      actionHeaders: new Headers(),
      errorHeaders: undefined,
    }),
  );

  expect(result.get("Cache-Control")).toBe("no-store");
  expect(result.get("X-Parent")).toBe("1");
});

it("loads the registrations, the remote overview and the console mode", async () => {
  services.agentWorkspaceService.page.mockResolvedValue({ title: "Local" });
  vi.mocked(loadRemoteOverview).mockResolvedValue(REMOTE);
  services.settingsService.getTerminalScreenReader.mockResolvedValue("off");

  const result = await loader(
    routeArguments(new Request("http://pages.invalid/agents/workspaces"), USER),
  );

  expect(result.data).toEqual({
    page: { title: "Local" },
    remote: REMOTE,
    terminalScreenReader: "off",
  });
  expect(new Headers(result.init?.headers).get("Cache-Control")).toBe(
    "no-store",
  );
  expect(services.agentWorkspaceService.page).toHaveBeenCalledWith("user-1");
  expect(vi.mocked(loadRemoteOverview)).toHaveBeenCalledWith(
    services,
    "user-1",
  );
});

it("refuses to load without a signed-in user", async () => {
  const response = await thrownByLoader(null);

  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({
    error: "workspace_access_denied",
  });
  expect(logCaughtError).toHaveBeenCalledWith(
    "agent_workspaces",
    expect.any(AgentError),
  );
});

it("turns a failing service into an uncacheable failure", async () => {
  services.agentWorkspaceService.page.mockRejectedValue(new Error("db down"));

  const response = await thrownByLoader(USER);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    ok: false,
    intent: "",
    error: "general",
  });
});

it("lists where a registration is used", async () => {
  services.agentWorkspaceService.usages.mockResolvedValue([{ id: "plan" }]);

  await expect(
    post({ intent: "workspace-usages", workspaceId: "ws-1" }),
  ).resolves.toEqual({
    status: 200,
    body: {
      ok: true,
      intent: "workspace-usages",
      workspaceUsages: [{ id: "plan" }],
    },
  });
  expect(services.agentWorkspaceService.usages).toHaveBeenCalledWith(
    "user-1",
    "ws-1",
  );
});

it("saves a new and an existing registration", async () => {
  services.agentWorkspaceService.save.mockResolvedValue(undefined);

  await expect(
    post({ intent: "save-workspace", workspace: '{"name":"New"}' }),
  ).resolves.toEqual({
    status: 200,
    body: { ok: true, intent: "save-workspace" },
  });
  await post({
    intent: "save-workspace",
    workspaceId: "ws-1",
    workspace: '{"name":"Old"}',
  });

  expect(services.agentWorkspaceService.save.mock.calls).toEqual([
    ["user-1", null, { name: "New" }],
    ["user-1", "ws-1", { name: "Old" }],
  ]);
});

it("refuses an oversized registration or identifier before saving", async () => {
  await expect(
    post({ intent: "save-workspace", workspace: "x".repeat(50001) }),
  ).resolves.toMatchObject({
    status: 400,
    body: { error: "workspace_invalid" },
  });
  await expect(
    post({ intent: "save-workspace", workspaceId: "w".repeat(101) }),
  ).resolves.toMatchObject({
    status: 400,
    body: { error: "workspace_invalid" },
  });
  expect(services.agentWorkspaceService.save).not.toHaveBeenCalled();
});

it("answers a registration that is no JSON with a general failure", async () => {
  await expect(post({ intent: "save-workspace" })).resolves.toEqual({
    status: 500,
    body: { ok: false, intent: "save-workspace", error: "general" },
  });
});

it("deletes a registration at a valid revision only", async () => {
  services.agentWorkspaceService.remove.mockResolvedValue(undefined);

  await expect(
    post({ intent: "delete-workspace", workspaceId: "ws-1", revision: "2" }),
  ).resolves.toEqual({
    status: 200,
    body: { ok: true, intent: "delete-workspace" },
  });
  for (const revision of ["0", "1.5", "x"])
    await expect(
      post({ intent: "delete-workspace", workspaceId: "ws-1", revision }),
    ).resolves.toMatchObject({
      status: 400,
      body: { error: "workspace_invalid" },
    });
  expect(services.agentWorkspaceService.remove).toHaveBeenCalledOnce();
  expect(services.agentWorkspaceService.remove).toHaveBeenCalledWith(
    "user-1",
    "ws-1",
    2,
  );
});

it("refuses a missing or unknown intent", async () => {
  await expect(post({})).resolves.toEqual({
    status: 400,
    body: { ok: false, intent: "", error: "workspace_invalid" },
  });
  await expect(post({ intent: "rename" })).resolves.toMatchObject({
    status: 400,
    body: { intent: "rename", error: "workspace_invalid" },
  });
});

it("refuses anything but a form post", async () => {
  const response = await action(
    routeArguments(new Request("http://pages.invalid/agents/workspaces"), USER),
  );

  expect(response.status).toBe(405);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});

it("reloads after every remote action and otherwise as React Router decides", () => {
  const args = (
    formAction: string | undefined,
    defaultShouldRevalidate: boolean,
  ): ShouldRevalidateFunctionArgs => ({
    currentUrl: new URL("http://pages.invalid/agents/workspaces"),
    currentParams: {},
    nextUrl: new URL("http://pages.invalid/agents/workspaces"),
    nextParams: {},
    formAction,
    defaultShouldRevalidate,
  });

  expect(shouldRevalidate(args("/agents/workspaces/remote", false))).toBe(true);
  expect(shouldRevalidate(args("/agents/workspaces", false))).toBe(false);
  expect(shouldRevalidate(args(undefined, true))).toBe(true);
});

it("shows the workspace page and a recoverable load failure", async () => {
  const router = createMemoryRouter([
    {
      path: "/",
      loader: () => ({
        page: { title: "Local" },
        remote: { label: "Remote" },
        terminalScreenReader: "off",
      }),
      Component: AgentWorkspacesRoute,
    },
    { path: "/broken", Component: ErrorBoundary },
  ]);
  render(<RouterProvider router={router} />);

  expect((await screen.findByRole("main")).textContent).toBe("Local Remote");

  await router.navigate("/broken");
  expect((await screen.findByRole("alert")).textContent).toBe("Load failed");
});
