// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RegionProvider } from "@/app/components/common/region-provider";
import { ConnectionConfirmation } from "@/app/components/settings/connections/connection-confirmation";
import { ConnectionTime } from "@/app/components/settings/connections/connection-time";
import { ConnectionsPanel } from "@/app/components/settings/connections/connections-panel";
import { OAuthConnectionsCard } from "@/app/components/settings/connections/oauth-connections-card";
import { OAuthConnectionsTable } from "@/app/components/settings/connections/oauth-connections-table";
import { PairingCommand } from "@/app/components/settings/connections/pairing-command";
import { PairingGuide } from "@/app/components/settings/connections/pairing-guide";
import { StdioConnectionsTable } from "@/app/components/settings/connections/stdio-connections-table";
import { TokenDurationForm } from "@/app/components/settings/connections/token-duration-form";
import { Toaster } from "@/app/components/ui/toast";
import { createI18n } from "@/app/lib/i18n";

import type { McpConnectionsView } from "@/definition/McpConnections";
import type { PersonalAgentToken } from "@/definition/McpAuthorization";
import type { ActionFunction } from "react-router";

const NOW = new Date("2026-10-11T12:00:00Z").getTime();
const token: PersonalAgentToken = {
  id: "paired",
  userId: "owner",
  name: "Laptop",
  source: "pairing",
  device: "workstation",
  createdAt: NOW - 3_600_000,
  lastUsedAt: NOW - 60_000,
  expiresAt: null,
  revokedAt: null,
  rotatedAt: null,
  rotationRequestedAt: null,
  status: "active",
};
const view: McpConnectionsView = {
  origin: "https://pages.invalid:4567",
  packageVersion: "0.1.0",
  validityDays: 30,
  tokens: [token],
  oauth: { durationSeconds: null, grants: [] },
};
const activeGrant = {
  id: "grant-active",
  clientName: "HTTP Client",
  verifiedAt: NOW - 86_400_000,
  expiresAt: null,
  status: "active",
};
const revokedGrant = {
  id: "grant-revoked",
  clientName: "Old Client",
  verifiedAt: NOW - 86_400_000,
  expiresAt: NOW,
  status: "revoked",
};

let router: ReturnType<typeof createMemoryRouter> | undefined;
afterEach(() => {
  router?.dispose();
  router = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function Translated({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <I18nextProvider i18n={createI18n("en")}>
      {children}
      <Toaster />
    </I18nextProvider>
  );
}

function renderPlain(element: React.ReactElement): void {
  render(<Translated>{element}</Translated>);
}

function renderRouted(
  element: React.ReactElement,
  action: ActionFunction = () => ({ updated: true }),
  loader: () => unknown = () => ({}),
): void {
  router = createMemoryRouter([
    {
      path: "/",
      element,
      loader,
      action,
      hydrateFallbackElement: <p>Loading</p>,
    },
  ]);
  render(
    <Translated>
      <RouterProvider router={router} />
    </Translated>,
  );
}

async function submittedForm(
  action: ReturnType<typeof vi.fn<ActionFunction>>,
  call = 0,
): Promise<Record<string, FormDataEntryValue>> {
  const form = await action.mock.calls[call][0].request.formData();
  return Object.fromEntries(form);
}

describe("A11.10 connection confirmation dialog", () => {
  function renderDialog(pending: boolean): {
    onCancel: ReturnType<typeof vi.fn>;
    onConfirm: ReturnType<typeof vi.fn>;
  } {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    renderPlain(
      <ConnectionConfirmation
        action={{ intent: "revoke-token", id: "paired", name: "Laptop" }}
        pending={pending}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );
    return { onCancel, onConfirm };
  }

  it("cancels when it is dismissed with the keyboard", async () => {
    const { onCancel, onConfirm } = renderDialog(false);
    expect(await screen.findByRole("dialog")).toHaveTextContent("Laptop");
    await userEvent.setup().keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("cannot be dismissed while the mutation is pending", async () => {
    const { onCancel } = renderDialog(true);
    const dialog = await screen.findByRole("dialog");
    const user = userEvent.setup();
    await user.keyboard("{Escape}");
    expect(onCancel).not.toHaveBeenCalled();
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toBeDisabled();
  });

  it("renders nothing while no action is selected", () => {
    renderPlain(
      <ConnectionConfirmation
        action={null}
        pending={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("A11.10 connection time", () => {
  it("shows a dash for a missing time and unlimited for a missing expiry", () => {
    renderPlain(
      <>
        <p data-testid="missing">
          <ConnectionTime time={null} />
        </p>
        <p data-testid="expiry">
          <ConnectionTime time={null} unlimited />
        </p>
      </>,
    );
    expect(screen.getByTestId("missing")).toHaveTextContent("—");
    expect(screen.getByTestId("expiry")).toHaveTextContent("Unlimited");
  });
});

describe("A11.10 OAuth card and grant table", () => {
  function renderCard(
    oauth: McpConnectionsView["oauth"],
    pending = false,
  ): ReturnType<typeof vi.fn> {
    const onAction = vi.fn();
    renderPlain(
      <OAuthConnectionsCard
        oauth={oauth}
        pending={pending}
        onDuration={vi.fn()}
        onAction={onAction}
      />,
    );
    return onAction;
  }

  it("shows the empty state instead of a table without grants", () => {
    renderCard({ durationSeconds: 604_800, grants: [] });
    expect(screen.getByText("No HTTP MCP grants.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Confirm again after" }),
    ).toHaveTextContent("7 days");
  });

  it("keeps an unusual stored duration selectable instead of hiding it", () => {
    renderCard({ durationSeconds: 12_345, grants: [] });
    expect(
      screen.getByRole("combobox", { name: "Confirm again after" }),
    ).toHaveTextContent("Current: 12345 s");
  });

  it("offers revocation only for active grants and reports the chosen grant", async () => {
    const onAction = renderCard({
      durationSeconds: null,
      grants: [activeGrant, revokedGrant],
    });
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getByText("Active")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Revoked")).toBeInTheDocument();
    expect(
      within(rows[2]).queryByRole("button", { name: "Revoke …" }),
    ).not.toBeInTheDocument();
    await userEvent
      .setup()
      .click(within(rows[1]).getByRole("button", { name: "Revoke …" }));
    expect(onAction).toHaveBeenCalledExactlyOnceWith({
      intent: "revoke-oauth-grant",
      id: "grant-active",
      name: "HTTP Client",
    });
  });

  it("disables revocation while a change is pending", () => {
    renderPlain(
      <OAuthConnectionsTable
        grants={[activeGrant]}
        pending
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Revoke …" })).toBeDisabled();
  });
});

describe("A11.10 stdio connection rows", () => {
  it("labels a pending rotation, the device and the rotation time of a credential", () => {
    renderPlain(
      <RegionProvider
        region={{ dateFormat: "YYYY-MM-DD", timezone: "Europe/Berlin" }}
      >
        <StdioConnectionsTable
          tokens={[
            {
              ...token,
              rotationRequestedAt: NOW - 1000,
              rotatedAt: NOW - 86_400_000,
            },
          ]}
          onAction={vi.fn()}
        />
      </RegionProvider>,
    );
    const row = screen.getAllByRole("row")[1];
    expect(within(row).getByText("Rotation pending")).toBeInTheDocument();
    expect(row).toHaveTextContent("Paired · workstation");
    expect(row).toHaveTextContent("rotated 2026-10-10 14:00");
    expect(
      within(row).getByRole("button", { name: "Actions for Laptop" }),
    ).toBeInTheDocument();
  });

  it("omits device and rotation details and the menu of an ended credential", () => {
    renderPlain(
      <StdioConnectionsTable
        tokens={[
          {
            ...token,
            source: "manual",
            device: null,
            status: "expired",
            expiresAt: NOW - 1000,
          },
        ]}
        onAction={vi.fn()}
      />,
    );
    const row = screen.getAllByRole("row")[1];
    expect(within(row).getByText("Expired")).toBeInTheDocument();
    expect(row).toHaveTextContent("Created manually");
    expect(row).not.toHaveTextContent("·");
    expect(within(row).queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("A11.10 pairing guide", () => {
  function renderGuide(onOpenChange: (open: boolean) => void): void {
    renderRouted(
      <PairingGuide
        open
        onOpenChange={onOpenChange}
        origin="https://pages.invalid:4567"
        version="0.1.0"
      />,
    );
  }

  it("closes through its close button", async () => {
    const onOpenChange = vi.fn();
    renderGuide(onOpenChange);
    const dialog = await screen.findByRole("dialog");
    await userEvent
      .setup()
      .click(within(dialog).getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("copies the exact command and confirms it", async () => {
    renderGuide(vi.fn());
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    await user.click(
      await screen.findByRole("button", { name: "Copy command" }),
    );
    const expected =
      "node pages-mcp-v0.1.0.js pair --url https://pages.invalid:4567";
    expect(writeText).toHaveBeenCalledExactlyOnceWith(expected);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Command copied.",
    );
  });
});

describe("A11.10 pairing command clipboard", () => {
  it("keeps the command visible and explains a refused copy", async () => {
    renderPlain(<PairingCommand command="node pair" />);
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
      new Error("denied"),
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy command" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Could not copy. Select the command and copy it manually.",
    );
    expect(screen.getByText("node pair")).toBeInTheDocument();
  });
});

describe("A11.10 token duration form", () => {
  it("submits the entered whole days without a page navigation", async () => {
    const onValidity = vi.fn();
    renderPlain(
      <TokenDurationForm days={30} pending={false} onValidity={onValidity} />,
    );
    const user = userEvent.setup();
    const input = screen.getByLabelText("Validity in days");
    expect(input).toHaveValue(30);
    await user.clear(input);
    await user.type(input, "7");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onValidity).toHaveBeenCalledExactlyOnceWith("7");
  });

  it("does not accept an empty value", async () => {
    const onValidity = vi.fn();
    renderPlain(
      <TokenDurationForm days={30} pending={false} onValidity={onValidity} />,
    );
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText("Validity in days"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onValidity).not.toHaveBeenCalled();
  });
});

describe("A11.10 connections panel", () => {
  it("shows a loading placeholder when a navigation takes long and restores the content", async () => {
    let release: () => void = () => undefined;
    let calls = 0;
    renderRouted(<ConnectionsPanel view={view} />, undefined, () => {
      calls += 1;
      return calls === 1
        ? {}
        : new Promise<object>((resolve) => {
            release = () => resolve({});
          });
    });
    expect(
      await screen.findByRole("button", { name: "Pair client" }),
    ).toBeInTheDocument();
    void router?.navigate("/?refresh=1");
    const busy = await screen.findByLabelText(
      "Loading connections",
      undefined,
      {
        timeout: 3000,
      },
    );
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(
      screen.queryByRole("button", { name: "Pair client" }),
    ).not.toBeInTheDocument();
    release();
    expect(
      await screen.findByRole("button", { name: "Pair client" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Loading connections"),
    ).not.toBeInTheDocument();
  });

  it("announces a failed validity change outside of a dialog and recovers on success", async () => {
    const action = vi
      .fn<ActionFunction>()
      .mockResolvedValueOnce({ error: "invalid_request" })
      .mockResolvedValueOnce({ updated: true });
    renderRouted(<ConnectionsPanel view={view} />, action);
    const user = userEvent.setup();
    const input = await screen.findByLabelText("Validity in days");
    await user.clear(input);
    await user.type(input, "7");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The change could not be saved. Please try again.",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await submittedForm(action)).toEqual({
      intent: "set-token-duration",
      days: "7",
    });

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Settings saved.")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
  });
});
