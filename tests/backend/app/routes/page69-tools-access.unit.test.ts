import { RouterContextProvider } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { action, loader } from "@/app/routes/settings-agent-tools";

import { TICKET_ACTOR } from "../../backend/service/agents/page55-ticket-fixture";
import { TOOL_ADMIN } from "../../backend/service/agents/tools/page69-tool-world";

const services = vi.hoisted(() => ({
  getContext: vi.fn(),
  list: vi.fn(),
  manage: vi.fn(),
  setEnabled: vi.fn(),
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({
    administrationService: { getContext: services.getContext },
    agentToolManagerService: {
      list: services.list,
      manage: services.manage,
      setEnabled: services.setEnabled,
    },
  }),
}));

const URL = "http://pages.invalid/settings/agents/tools";

function context(isAuthenticated = true): RouterContextProvider {
  const result = new RouterContextProvider();
  result.set(authenticatedUserContext, isAuthenticated ? TICKET_ACTOR : null);
  return result;
}

function load(isAuthenticated = true): ReturnType<typeof loader> {
  return loader({
    request: new Request(URL),
    context: context(isAuthenticated),
    params: {},
    url: new globalThis.URL(URL),
    pattern: "/settings/agents/tools",
  });
}

function submit(
  input: Readonly<Record<string, string>> = {
    tool: "codex",
    intent: "install",
  },
  origin = "http://pages.invalid",
): Promise<Response> {
  return action({
    request: new Request(URL, {
      method: "POST",
      headers: { Origin: origin },
      body: new URLSearchParams(input),
    }),
    context: context(),
    params: {},
    url: new globalThis.URL(URL),
    pattern: "/settings/agents/tools",
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  services.getContext.mockResolvedValue(TOOL_ADMIN);
  services.list.mockReturnValue([]);
});

it.each([
  { ...TOOL_ADMIN, isAdmin: false },
  { ...TOOL_ADMIN, mode: "role" as const },
  { ...TOOL_ADMIN, isActive: false },
])(
  "rejects loader and direct POSTs without an active system administrator",
  async (actor) => {
    services.getContext.mockResolvedValue(actor);
    await expect(load()).rejects.toMatchObject({ status: 403 });
    const response = await submit();
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(services.list).not.toHaveBeenCalled();
    expect(services.manage).not.toHaveBeenCalled();
  },
);

it("does not expose tool status to an unauthenticated direct loader request", async () => {
  await expect(load(false)).rejects.toMatchObject({ status: 403 });
  expect(services.getContext).not.toHaveBeenCalled();
  expect(services.list).not.toHaveBeenCalled();
});

it("returns only the cached inventory and routes fixed actions after checking fresh rights", async () => {
  const result = await load();
  expect(result.data.tools).toEqual([]);
  expect(result.init?.headers).toMatchObject({ "Cache-Control": "no-store" });
  expect((await submit()).status).toBe(200);
  expect(services.manage).toHaveBeenCalledWith(TOOL_ADMIN, "codex", "install");
  expect(
    (await submit({ tool: "playwright_mcp", intent: "enable" })).status,
  ).toBe(200);
  expect(services.setEnabled).toHaveBeenCalledWith(
    TOOL_ADMIN,
    "playwright_mcp",
    true,
  );
});

it("refuses foreign origins, arbitrary package IDs and shell-like actions before manager execution", async () => {
  expect((await submit(undefined, "https://foreign.invalid")).status).toBe(403);
  expect(
    (await submit({ tool: "arbitrary-package; command", intent: "install" }))
      .status,
  ).toBe(400);
  expect(
    (await submit({ tool: "codex", intent: "npm install something" })).status,
  ).toBe(400);
  expect(services.manage).not.toHaveBeenCalled();
});
