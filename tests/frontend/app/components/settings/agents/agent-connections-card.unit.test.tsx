import { fireEvent, render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import { AgentConnectionsCard } from "@/app/components/settings/agents/agent-connections-card";
import { createI18n } from "@/app/lib/i18n";
import { GLOBAL_CONNECTION_SCOPE } from "@/definition/AgentConnectionScope";

import type { Mock } from "vitest";
import type { AgentCommandHandler } from "@/app/components/settings/agents/agent-row-menu";
import type {
  AgentAccessKind,
  AgentConnectionSummary,
  CliToolLocations,
} from "@/definition/AgentConnection";

const i18n = createI18n("en");

const CLI_TOOLS: CliToolLocations = {
  codex_cli: { found: true, path: "/usr/local/bin/codex" },
  claude_code: { found: false, path: null },
  opencode: { found: true, path: "/opt/opencode/bin/opencode" },
  antigravity: { found: false, path: null },
};

function apiConnection(
  overrides: Partial<AgentConnectionSummary> = {},
): AgentConnectionSummary {
  return {
    isActive: true,
    id: "api-1",
    name: "OpenRouter main",
    provider: "openrouter",
    accessKind: "api_key",
    hasApiKey: true,
    testModel: null,
    reasoningEffort: null,
    scope: GLOBAL_CONNECTION_SCOPE,
    cli: null,
    checks: { auth: null, model: null },
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function cliConnection(
  overrides: Partial<AgentConnectionSummary> = {},
): AgentConnectionSummary {
  return apiConnection({
    id: "cli-1",
    name: "Claude on host",
    provider: "claude_code",
    accessKind: "cli_account",
    hasApiKey: false,
    cli: {
      binaryFound: true,
      loggedInAt: "2026-01-01T00:00:00.000Z",
      accountLabel: null,
      login: null,
      terminalCommand: "claude",
    },
    ...overrides,
  });
}

interface Handlers {
  readonly onAdd: Mock<(kind: AgentAccessKind) => void>;
  readonly onEdit: Mock<(connection: AgentConnectionSummary) => void>;
  readonly onCommand: Mock<AgentCommandHandler>;
}

function renderCard(
  kind: AgentAccessKind,
  connections: readonly AgentConnectionSummary[],
  disabled = false,
): Handlers {
  const handlers: Handlers = {
    onAdd: vi.fn<Handlers["onAdd"]>(),
    onEdit: vi.fn<Handlers["onEdit"]>(),
    onCommand: vi.fn<AgentCommandHandler>(),
  };
  render(
    <I18nextProvider i18n={i18n}>
      <AgentConnectionsCard
        cliTools={CLI_TOOLS}
        connections={connections}
        disabled={disabled}
        kind={kind}
        {...handlers}
      />
    </I18nextProvider>,
  );
  return handlers;
}

it("shows the API title, empty hint and no CLI locations without connections", () => {
  renderCard("api_key", []);

  expect(screen.getByRole("heading", { name: "API" })).toBeTruthy();
  expect(screen.getByText("No API connections configured yet.")).toBeTruthy();
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.queryByText("Installed CLI tools and setup")).toBeNull();
});

it("shows the CLI title, empty hint and the installed tool locations", () => {
  renderCard("cli_account", []);

  expect(screen.getByRole("heading", { name: "Local" })).toBeTruthy();
  expect(screen.getByText("No CLI connections configured yet.")).toBeTruthy();
  expect(screen.getByText("Installed CLI tools and setup")).toBeTruthy();
  expect(screen.getByText("/usr/local/bin/codex")).toBeTruthy();
  expect(screen.getByText("/opt/opencode/bin/opencode")).toBeTruthy();
  expect(screen.getAllByText("CLI not found")).toHaveLength(2);
});

it.each([
  ["api_key", "Add API connection"],
  ["cli_account", "Add CLI connection"],
] as const)("adds a %s connection through its button", (kind, label) => {
  const { onAdd } = renderCard(kind, []);

  fireEvent.click(screen.getByRole("button", { name: label }));

  expect(onAdd).toHaveBeenCalledExactlyOnceWith(kind);
});

it("lists each connection with provider, scope, status and last check", () => {
  renderCard("api_key", [
    apiConnection({
      checks: {
        auth: {
          status: "passed",
          errorCode: null,
          checkedAt: "2026-01-01T00:00:00.000Z",
          durationMs: 5,
          detail: {},
        },
        model: null,
      },
    }),
    apiConnection({
      id: "api-2",
      name: "Restricted key",
      scope: {
        mode: "restricted",
        targets: [
          { kind: "person", targetId: "p1" },
          { kind: "group", targetId: "g1" },
        ],
      },
    }),
  ]);

  const headers = screen
    .getAllByRole("columnheader")
    .map((header) => header.textContent);
  expect(headers).toEqual([
    "Name",
    "Provider/tool",
    "Use",
    "Status",
    "Last checked",
    "Actions",
  ]);

  const [, first, second] = screen.getAllByRole("row");
  expect(within(first).getByText("OpenRouter main")).toBeTruthy();
  expect(within(first).getByText("OpenRouter")).toBeTruthy();
  expect(within(first).getByText("Global")).toBeTruthy();
  expect(within(first).getByText("Access confirmed")).toBeTruthy();
  expect(within(second).getByText("Restricted (2)")).toBeTruthy();
  expect(within(second).getByText("Not checked")).toBeTruthy();
  expect(within(second).getByText("Not checked yet")).toBeTruthy();
});

it("opens the editor from the name and from the edit button", () => {
  const connection = apiConnection();
  const { onEdit } = renderCard("api_key", [connection]);

  fireEvent.click(screen.getByRole("button", { name: "OpenRouter main" }));
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));

  expect(onEdit).toHaveBeenCalledTimes(2);
  expect(onEdit).toHaveBeenNthCalledWith(1, connection);
  expect(onEdit).toHaveBeenNthCalledWith(2, connection);
});

it("offers to configure a CLI connection that is not signed in yet", () => {
  renderCard("cli_account", [
    cliConnection({
      cli: {
        binaryFound: true,
        loggedInAt: null,
        accountLabel: null,
        login: null,
        terminalCommand: "claude",
      },
    }),
  ]);

  expect(screen.getByRole("button", { name: "Configure" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
});

it("offers to edit a signed-in CLI connection", () => {
  renderCard("cli_account", [cliConnection()]);

  expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Configure" })).toBeNull();
});

it("also lists the tool locations below a CLI table", () => {
  renderCard("cli_account", [cliConnection()]);

  expect(screen.getByRole("table")).toBeTruthy();
  expect(screen.getByText("Installed CLI tools and setup")).toBeTruthy();
});

it("passes commands of the row menu on with the connection", () => {
  const connection = apiConnection();
  const { onCommand } = renderCard("api_key", [connection]);

  fireEvent.pointerDown(
    screen.getByRole("button", { name: "Actions for OpenRouter main" }),
    { button: 0, ctrlKey: false },
  );
  fireEvent.click(screen.getByRole("menuitem", { name: "Check access" }));

  expect(onCommand).toHaveBeenCalledExactlyOnceWith(connection, "auth");
});

it("disables the row menu commands while the card is disabled", () => {
  renderCard("api_key", [apiConnection()], true);

  fireEvent.pointerDown(
    screen.getByRole("button", { name: "Actions for OpenRouter main" }),
    { button: 0, ctrlKey: false },
  );

  expect(
    screen
      .getByRole("menuitem", { name: "Check access" })
      .getAttribute("aria-disabled"),
  ).toBe("true");
});
