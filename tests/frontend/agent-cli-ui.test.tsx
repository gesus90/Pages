// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";

import { RegionProvider } from "@/app/components/common/region-provider";
import { AgentChecks } from "@/app/components/settings/agents/agent-checks";
import { AgentCliLogin } from "@/app/components/settings/agents/agent-cli-login";
import { AgentConfirmation } from "@/app/components/settings/agents/agent-confirmation";
import { AgentRowMenu } from "@/app/components/settings/agents/agent-row-menu";
import { createI18n } from "@/app/lib/i18n";

import { createAgentConnection, createCliConnection } from "../helpers/agents";

import type { AgentActions } from "@/app/components/settings/agents/use-agent-actions";
import type { AgentCliState } from "@/definition/AgentConnection";
import type { ReactNode } from "react";

function show(children: ReactNode): ReturnType<typeof render> {
  const i18n = createI18n("en");
  return render(children, {
    wrapper: ({ children: content }) => (
      <I18nextProvider i18n={i18n}>{content}</I18nextProvider>
    ),
  });
}

function cli(overrides: Partial<AgentCliState> = {}): AgentCliState {
  return {
    binaryFound: true,
    loggedInAt: null,
    accountLabel: null,
    login: null,
    terminalCommand:
      "env -i HOME=/synthetic/home /synthetic/codex login --device-auth",
    ...overrides,
  };
}

function createActions(overrides: Partial<AgentActions> = {}): AgentActions {
  return {
    isPending: false,
    pendingIntent: null,
    error: null,
    result: undefined,
    submit: vi.fn(),
    ...overrides,
  };
}

describe("CLI account UI", () => {
  it("hides login controls when the CLI is missing and does nothing for API connections", () => {
    const { rerender } = show(
      <AgentCliLogin
        connection={createAgentConnection()}
        disabled={false}
        actions={createActions()}
        onCommand={vi.fn()}
      />,
    );
    expect(screen.queryByRole("heading")).toBeNull();
    rerender(
      <AgentCliLogin
        connection={createCliConnection({ cli: cli({ binaryFound: false }) })}
        disabled={false}
        actions={createActions()}
        onCommand={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "CLI not found" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/service must find the executable/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers explicit login, isolated terminal copy and local status checks", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    const connection = createCliConnection({ cli: cli() });
    show(
      <AgentCliLogin
        connection={connection}
        disabled={false}
        actions={createActions()}
        onCommand={onCommand}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Start sign-in" }));
    expect(onCommand).toHaveBeenCalledWith(connection, "login");
    expect(screen.getByText(/ChatGPT security settings/)).toBeInTheDocument();
    await user.click(
      screen.getByText("Alternatively, sign in from the server terminal"),
    );
    const clipboard = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    await user.click(screen.getByRole("button", { name: "Copy command" }));
    expect(clipboard).toHaveBeenCalledWith(connection.cli?.terminalCommand);
    expect(await screen.findByText("Copied.")).toBeInTheDocument();
    clipboard.mockRejectedValue(new Error("clipboard denied"));
    await user.click(screen.getByRole("button", { name: "Copy command" }));
    expect(await screen.findByText(/Select and copy/)).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Check sign-in status" }),
    );
    expect(onCommand).toHaveBeenLastCalledWith(connection, "auth");
  });

  it("shows timestamped account labels and expired-session recovery", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    const connection = createCliConnection({
      provider: "claude_code",
      cli: cli({
        loggedInAt: "2026-10-08T10:00:00Z",
        accountLabel: "synthetic@example.invalid",
        login: { state: "expired", errorCode: "login_expired" },
      }),
    });
    show(
      <AgentCliLogin
        connection={connection}
        disabled={false}
        actions={createActions()}
        onCommand={onCommand}
      />,
    );
    expect(screen.getByText(/Signed in since/)).toHaveTextContent(
      "synthetic@example.invalid",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/expired/);
    // Ended sessions use the inline error block of the design system.
    expect(screen.getByRole("alert")).toHaveClass(
      "rounded-xl",
      "border-destructive/30",
      "bg-destructive/5",
    );
    await user.click(screen.getByRole("button", { name: "Sign in again" }));
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onCommand).toHaveBeenLastCalledWith(connection, "logout");
  });

  it("shows the ephemeral device challenge with a safe external link and cancellation", async () => {
    const user = userEvent.setup();
    const actions = createActions();
    const connection = createCliConnection({
      cli: cli({
        login: {
          state: "awaiting_user",
          userCode: "TEST-CODE",
          verificationUrl: "https://auth.openai.com/codex/device",
          expiresAt: "2026-10-08T10:15:00Z",
        },
      }),
    });
    // A chosen zone keeps the expected clock time independent of the machine.
    show(
      <RegionProvider region={{ dateFormat: "DD.MM.YYYY", timezone: "UTC" }}>
        <AgentCliLogin
          connection={connection}
          disabled
          actions={actions}
          onCommand={vi.fn()}
        />
      </RegionProvider>,
    );
    expect(
      screen.getByRole("link", { name: "Open sign-in page" }),
    ).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText("TEST-CODE")).toHaveClass("pages-selectable");
    expect(screen.getByText(/Valid until/)).toHaveTextContent("10:15");
    await user.click(screen.getByRole("button", { name: "Copy code" }));
    expect(await screen.findByText("Copied.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(actions.submit).toHaveBeenCalledWith("cancel-login", connection.id);
  });

  it("keeps a rejected Claude code, clears it on success, and disables duplicate submission", async () => {
    const user = userEvent.setup();
    const actions = createActions();
    const connection = createCliConnection({
      provider: "claude_code",
      cli: cli({ login: { state: "awaiting_user" } }),
    });
    const { rerender } = show(
      <AgentCliLogin
        connection={connection}
        disabled={false}
        actions={actions}
        onCommand={vi.fn()}
      />,
    );
    const field = screen.getByLabelText("Code from the Anthropic page");
    expect(
      screen.getByRole("button", { name: "Complete sign-in" }),
    ).toBeDisabled();
    await user.type(field, "synthetic-entered-code");
    await user.click(screen.getByRole("button", { name: "Complete sign-in" }));
    expect(actions.submit).toHaveBeenCalledWith(
      "submit-login-code",
      connection.id,
      { code: "synthetic-entered-code" },
    );
    rerender(
      <AgentCliLogin
        connection={connection}
        disabled={false}
        actions={{
          ...actions,
          error: "login_code_rejected",
          result: {
            ok: false,
            intent: "submit-login-code",
            error: "login_code_rejected",
          },
        }}
        onCommand={vi.fn()}
      />,
    );
    expect(field).toHaveValue("synthetic-entered-code");
    expect(field).toHaveAttribute("aria-invalid", "true");
    rerender(
      <AgentCliLogin
        connection={connection}
        disabled
        actions={{
          ...actions,
          isPending: true,
          pendingIntent: "submit-login-code",
          error: "login_code_invalid",
        }}
        onCommand={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Complete sign-in" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    rerender(
      <AgentCliLogin
        connection={connection}
        disabled={false}
        actions={{
          ...actions,
          result: { ok: true, intent: "submit-login-code" },
        }}
        onCommand={vi.fn()}
      />,
    );
    await waitFor(() => expect(field).toHaveValue(""));
    rerender(
      <AgentCliLogin
        connection={connection}
        disabled={false}
        actions={{ ...actions, result: { ok: true, intent: "start-login" } }}
        onCommand={vi.fn()}
      />,
    );
    rerender(
      <AgentCliLogin
        connection={{
          ...connection,
          cli: cli({ login: { state: "verifying" } }),
        }}
        disabled
        actions={actions}
        onCommand={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("Code from the Anthropic page")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Verifying sign-in locally",
    );
  });

  it("offers context-sensitive row actions and blocks mutations during active login", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onCommand = vi.fn();
    let connection = createCliConnection();
    const { rerender } = show(
      <AgentRowMenu
        connection={connection}
        disabled={false}
        onEdit={onEdit}
        onCommand={onCommand}
      />,
    );
    for (const label of ["Edit", "Check sign-in status", "Start sign-in"]) {
      await user.click(
        screen.getByRole("button", { name: "Actions for Test connection" }),
      );
      await user.click(screen.getByRole("menuitem", { name: label }));
    }
    expect(onEdit).toHaveBeenCalledWith(connection);
    expect(onCommand).toHaveBeenCalledWith(connection, "auth");
    expect(onCommand).toHaveBeenCalledWith(connection, "login");
    connection = createCliConnection({
      cli: cli({ loggedInAt: "2026-10-08T10:00:00Z" }),
    });
    rerender(
      <AgentRowMenu
        connection={connection}
        disabled={false}
        onEdit={onEdit}
        onCommand={onCommand}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Actions for Test connection" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(onCommand).toHaveBeenLastCalledWith(connection, "logout");
    connection = createCliConnection({
      cli: cli({ login: { state: "starting" } }),
    });
    rerender(
      <AgentRowMenu
        connection={connection}
        disabled={false}
        onEdit={onEdit}
        onCommand={onCommand}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Actions for Test connection" }),
    );
    expect(screen.getByRole("menuitem", { name: "Remove" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await user.keyboard("{Escape}");
    rerender(
      <AgentRowMenu
        connection={createCliConnection({ cli: cli({ binaryFound: false }) })}
        disabled={false}
        onEdit={onEdit}
        onCommand={onCommand}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Actions for Test connection" }),
    );
    expect(
      screen.getByRole("menuitem", { name: "Check sign-in status" }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("confirms CLI deletion and logout with their distinct effects", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    const connection = createCliConnection();
    const { rerender } = show(
      <AgentConfirmation
        request={{ connection, command: "delete" }}
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Personal CLI sign-ins on the server are unchanged.",
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    rerender(
      <AgentConfirmation
        request={{ connection, command: "logout" }}
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onConfirm).toHaveBeenCalled();
    rerender(
      <AgentConfirmation
        request={{ connection, command: "model" }}
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("CLI default model");
  });

  it("distinguishes free API checks, Z.AI minimal requests and local CLI checks", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    const { rerender } = show(
      <AgentChecks
        connection={createAgentConnection()}
        disabled={false}
        isChecking={false}
        onCommand={onCommand}
      />,
    );
    expect(
      screen.getByText(/Choose and save a model before/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Run model test" }),
    ).toBeDisabled();
    rerender(
      <AgentChecks
        connection={createAgentConnection({
          provider: "zai",
          testModel: "glm-4.7-flash",
        })}
        disabled={false}
        isChecking={false}
        onCommand={onCommand}
      />,
    );
    expect(screen.getByText(/free minimal request/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Run model test" }));
    expect(onCommand).toHaveBeenCalledWith(expect.anything(), "model");
    rerender(
      <AgentChecks
        connection={createCliConnection()}
        disabled
        isChecking
        onCommand={onCommand}
      />,
    );
    expect(screen.getByText(/without a server request/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run CLI test" })).toBeDisabled();
  });
});
