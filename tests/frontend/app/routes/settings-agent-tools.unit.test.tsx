import { act, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { requireAgentAccount } from "@/app/lib/settings-actions/settings-agents-access.server";
import SettingsAgentToolsRoute, {
  action,
  headers,
  loader,
} from "@/app/routes/settings-agent-tools";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentToolReadinessError } from "@/backend/service/agents/tools/AgentToolReadinessError";

import {
  accountAccess,
  ACTOR,
  formPost,
  headerArguments,
  i18n,
  pagesRequest,
  renderRoute,
  responseOf,
  routeArguments,
} from "./route-fixture";

const tools = vi.hoisted(() => ({
  list: vi.fn(),
  setEnabled: vi.fn(),
  manage: vi.fn(),
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async (): Promise<unknown> => ({
    agentToolManagerService: tools,
  }),
}));
vi.mock("@/app/lib/settings-actions/settings-agents-access.server", () => ({
  requireAgentAccount: vi.fn(),
}));
vi.mock("@/app/components/settings/agents/tools/agent-tool-card", () => ({
  AgentToolCard: (props: {
    readonly tool: { readonly id: string };
  }): React.ReactElement => <p>{`tool ${props.tool.id}`}</p>,
}));

const ADMIN = accountAccess({ isAdmin: true, mode: "admin" });

/**
 * A same-origin tool post.
 *
 * @param fields - Submitted fields.
 */
function toolPost(fields: Record<string, string>): Request {
  return formPost("/settings/agents/tools", fields);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAgentAccount).mockResolvedValue(ADMIN);
  tools.list.mockReturnValue([{ id: "node" }]);
});

afterEach(() => {
  vi.useRealTimers();
});

it("lists the tools for a current administrator without caching", async () => {
  const result = await loader(
    routeArguments(pagesRequest("/settings/agents/tools"), { user: ACTOR }),
  );

  expect(result.data).toEqual({ tools: [{ id: "node" }] });
  expect(result.init).toMatchObject({
    headers: { "Cache-Control": "no-store" },
  });
  expect(requireAgentAccount).toHaveBeenCalledWith(expect.anything(), ACTOR);
  expect(tools.list).toHaveBeenCalledWith(ADMIN);
});

it("refuses the list to everybody else", async () => {
  vi.mocked(requireAgentAccount).mockRejectedValue(
    new AgentError("configuration_invalid"),
  );

  const response = await responseOf(
    loader(routeArguments(pagesRequest("/settings/agents/tools"))),
  );

  expect(response.status).toBe(400);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});

it("accepts only posts", async () => {
  const response = await action(
    routeArguments(pagesRequest("/settings/agents/tools"), { user: ACTOR }),
  );

  expect(response.status).toBe(405);
  expect(response.headers.get("Allow")).toBe("POST");
});

it("refuses a cross-origin post before checking the account", async () => {
  const response = await action(
    routeArguments(
      pagesRequest("/settings/agents/tools", {
        method: "POST",
        headers: { Origin: "https://evil.invalid" },
      }),
      { user: ACTOR },
    ),
  );

  expect(response.status).toBe(403);
  expect(requireAgentAccount).not.toHaveBeenCalled();
});

it("refuses an unknown tool or intent", async () => {
  const unknownTool = await action(
    routeArguments(toolPost({ tool: "rm", intent: "enable" }), { user: ACTOR }),
  );
  const unknownIntent = await action(
    routeArguments(toolPost({ tool: "node", intent: "explode" }), {
      user: ACTOR,
    }),
  );

  expect(unknownTool.status).toBe(400);
  expect(unknownIntent.status).toBe(400);
  expect(tools.setEnabled).not.toHaveBeenCalled();
  expect(tools.manage).not.toHaveBeenCalled();
});

it("switches a tool on and off", async () => {
  const enabled = await action(
    routeArguments(toolPost({ tool: "node", intent: "enable" }), {
      user: ACTOR,
    }),
  );
  await action(
    routeArguments(toolPost({ tool: "node", intent: "disable" }), {
      user: ACTOR,
    }),
  );

  await expect(enabled.json()).resolves.toEqual({ ok: true });
  expect(tools.setEnabled.mock.calls).toEqual([
    [ADMIN, "node", true],
    [ADMIN, "node", false],
  ]);
});

it("runs a maintenance action", async () => {
  await action(
    routeArguments(toolPost({ tool: "codex", intent: "install" }), {
      user: ACTOR,
    }),
  );

  expect(tools.manage).toHaveBeenCalledWith(ADMIN, "codex", "install");
});

it("reports a tool that is not ready with its diagnostic", async () => {
  tools.manage.mockRejectedValue(
    new AgentToolReadinessError("codex", "failed", "not_installed"),
  );

  const response = await action(
    routeArguments(toolPost({ tool: "codex", intent: "repair" }), {
      user: ACTOR,
    }),
  );

  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toEqual({
    ok: false,
    diagnostic: "not_installed",
    tool: "codex",
  });
});

it("never caches the tool page", () => {
  const result = new Headers(
    headers(
      headerArguments({ "Cache-Control": "public", "X-Frame-Options": "DENY" }),
    ),
  );

  expect(result.get("Cache-Control")).toBe("no-store");
  expect(result.get("X-Frame-Options")).toBe("DENY");
});

it("renders the inventory and polls its status", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const reload = vi.fn(() => ({ tools: [{ id: "node" }, { id: "codex" }] }));
  const view = renderRoute(SettingsAgentToolsRoute, {
    loaderData: { tools: [{ id: "node" }] },
    loader: reload,
  });

  expect(screen.getByRole("heading").textContent).toBe(
    i18n.t("agentTools.title"),
  );
  expect(screen.getByRole("link").getAttribute("href")).toBe(
    "/settings/agents",
  );
  expect(screen.getByText("tool node")).toBeTruthy();

  await act(async () => {
    vi.advanceTimersByTime(5000);
  });
  expect(await screen.findByText("tool codex")).toBeTruthy();
  expect(reload).toHaveBeenCalledTimes(1);

  view.unmount();
  vi.advanceTimersByTime(5000);
  expect(reload).toHaveBeenCalledTimes(1);
});
