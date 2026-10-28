import { screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { readAgentAccount } from "@/app/lib/settings-actions/settings-agents-access.server";
import { handleAgentsAction } from "@/app/lib/settings-actions/settings-agents-actions.server";
import SettingsAgentsRoute, {
  action,
  headers,
  loader,
} from "@/app/routes/settings-agents";
import { AgentAccessDeniedError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

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

const services = vi.hoisted(() => ({
  agentConnectionService: { list: vi.fn() },
  agentCliLoginService: { tools: vi.fn() },
  agentCatalogService: { list: vi.fn() },
  agentProfileService: { directory: vi.fn() },
  picaSettingsService: { administration: vi.fn() },
  runnerService: { overview: vi.fn() },
  openCodeProviderLinks: { describe: vi.fn() },
  runnerGitHubMode: "offline",
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async (): Promise<unknown> => services,
}));
vi.mock("@/app/lib/settings-actions/settings-agents-access.server", () => ({
  readAgentAccount: vi.fn(),
}));
vi.mock("@/app/lib/settings-actions/settings-agents-actions.server", () => ({
  handleAgentsAction: vi.fn(),
}));
vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));
vi.mock("@/app/components/settings/agents/agents-section", () => ({
  AgentsSection: (props: {
    readonly connections: readonly { readonly id: string }[];
  }): React.ReactElement => (
    <p>{`connections ${props.connections.map((entry) => entry.id).join(",")}`}</p>
  ),
}));
vi.mock("@/app/components/settings/agents/runner-connections-card", () => ({
  RunnerConnectionsCard: (props: {
    readonly githubMode: string;
  }): React.ReactElement => <p>{`runners ${props.githubMode}`}</p>,
}));
vi.mock("@/app/components/settings/agents/pica-settings-card", () => ({
  PicaSettingsCard: (props: {
    readonly models: readonly unknown[];
  }): React.ReactElement => <p>{`pica ${props.models.length}`}</p>,
}));
vi.mock("@/app/components/settings/admin-mode-required", () => ({
  AdminModeRequired: (props: {
    readonly description: string;
  }): React.ReactElement => <p>{`admin mode ${props.description}`}</p>,
}));

const ADMIN = accountAccess({ isAdmin: true, mode: "admin" });
const LINKS = [{ provider: "zai", state: "linked" }];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readAgentAccount).mockResolvedValue(ADMIN);
  services.agentConnectionService.list.mockResolvedValue([
    { id: "c-1", provider: "opencode" },
    { id: "c-2", provider: "openai" },
  ]);
  services.agentCliLoginService.tools.mockResolvedValue({ codex: null });
  services.agentCatalogService.list.mockResolvedValue({});
  services.agentProfileService.directory.mockResolvedValue({ groups: [] });
  services.picaSettingsService.administration.mockResolvedValue({
    settings: {},
    models: [],
  });
  services.runnerService.overview.mockResolvedValue([]);
  services.openCodeProviderLinks.describe.mockResolvedValue(LINKS);
});

it("never caches the agent settings and keeps parent headers", () => {
  const result = new Headers(
    headers(headerArguments({ "X-Frame-Options": "DENY" })),
  );

  expect(result.get("Cache-Control")).toBe("no-store");
  expect(result.get("X-Frame-Options")).toBe("DENY");
});

it("asks an administrator outside the admin mode to switch it on", async () => {
  vi.mocked(readAgentAccount).mockResolvedValue(
    accountAccess({ isAdmin: true }),
  );

  const result = await loader(
    routeArguments(pagesRequest("/settings/agents"), { user: ACTOR }),
  );

  expect(result.data).toEqual({ access: "adminModeRequired" });
  expect(services.agentConnectionService.list).not.toHaveBeenCalled();
});

it("loads the management data and links OpenCode to its keys", async () => {
  const result = await loader(
    routeArguments(pagesRequest("/settings/agents"), { user: ACTOR }),
  );

  expect(result.data).toEqual({
    access: "granted",
    connections: [
      { id: "c-1", provider: "opencode", openCodeLinks: LINKS },
      { id: "c-2", provider: "openai" },
    ],
    runners: [],
    runnerGitHubMode: "offline",
    cliTools: { codex: null },
    catalogs: {},
    profileDirectory: { groups: [] },
    pica: { settings: {}, models: [] },
  });
  expect(result.init).toMatchObject({
    headers: { "Cache-Control": "no-store" },
  });
  expect(services.runnerService.overview).toHaveBeenCalledWith("user-1");
});

it("refuses accounts without the administrator right", async () => {
  const denied = new AgentAccessDeniedError();
  vi.mocked(readAgentAccount).mockRejectedValue(denied);

  const response = await responseOf(
    loader(routeArguments(pagesRequest("/settings/agents"), { user: ACTOR })),
  );

  expect(response.status).toBe(403);
  expect(logCaughtError).toHaveBeenCalledWith("settings_agents", denied);
});

it("hands a post to the agent actions", async () => {
  const outcome = Response.json({ ok: true });
  vi.mocked(handleAgentsAction).mockResolvedValue(outcome);

  await expect(
    action(
      routeArguments(formPost("/settings/agents", { intent: "check" }), {
        user: ACTOR,
      }),
    ),
  ).resolves.toBe(outcome);
  expect(
    vi.mocked(handleAgentsAction).mock.calls[0]?.[0].formData.get("intent"),
  ).toBe("check");
});

it("answers a failed action without its details", async () => {
  vi.mocked(handleAgentsAction).mockRejectedValue(new Error("secret"));

  const response = await action(
    routeArguments(formPost("/settings/agents"), { user: ACTOR }),
  );

  expect(response.status).toBe(500);
  await expect(response.json()).resolves.toEqual({
    ok: false,
    intent: "",
    error: "general",
  });
});

it("renders the management sections for the admin mode", () => {
  renderRoute(SettingsAgentsRoute, {
    loaderData: {
      access: "granted",
      connections: [{ id: "c-1" }],
      runners: [],
      runnerGitHubMode: "http",
      cliTools: {},
      catalogs: {},
      profileDirectory: {},
      pica: { settings: {}, models: [{ id: "m" }] },
    },
  });

  expect(screen.getByRole("heading").textContent).toBe(
    i18n.t("settings.agents.title"),
  );
  expect(screen.getByText("connections c-1")).toBeTruthy();
  expect(screen.getByText("runners http")).toBeTruthy();
  expect(screen.getByText("pica 1")).toBeTruthy();
  expect(screen.getByRole("link").getAttribute("href")).toBe(
    "/settings/agents/tools",
  );
});

it("asks for the admin mode otherwise", () => {
  renderRoute(SettingsAgentsRoute, {
    loaderData: { access: "adminModeRequired" },
  });

  expect(
    screen.getByText(
      `admin mode ${i18n.t("settings.agents.adminModeRequired")}`,
    ),
  ).toBeTruthy();
});
