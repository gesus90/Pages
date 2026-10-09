// @vitest-environment jsdom
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createRoutesStub } from "react-router";
import { describe, expect, it, vi } from "vitest";

const pending = vi.hoisted(() => vi.fn(() => false));
vi.mock("@/app/components/users/use-management-pending", () => ({
  useManagementPending: pending,
}));

import { Toaster } from "@/app/components/ui/toast";
import { createI18n } from "@/app/lib/i18n";
import SettingsAgentsRoute from "@/app/routes/settings-agents";

import {
  CLI_LOCATIONS,
  createAgentConnection,
  createCliConnection,
} from "../helpers/agents";

import type { AgentActionResult } from "@/app/lib/settings-actions/settings-agents-response.server";
import type { AgentConnectionSummary } from "@/definition/AgentConnection";

interface AgentStory {
  connections: AgentConnectionSummary[];
  readonly access?: "adminModeRequired";
  readonly onAction?: (
    form: FormData,
  ) => AgentActionResult | Promise<AgentActionResult>;
}

function renderStory(story: AgentStory): ReturnType<typeof userEvent.setup> {
  const Stub = createRoutesStub([
    {
      path: "/settings/agents",
      Component: SettingsAgentsRoute,
      loader: () =>
        story.access
          ? { access: story.access }
          : {
              access: "granted",
              connections: story.connections,
              cliTools: CLI_LOCATIONS,
            },
      action: async ({ request }) => {
        const form = await request.formData();
        return (
          story.onAction?.(form) ?? {
            ok: true,
            intent: String(form.get("intent")),
          }
        );
      },
    },
  ]);
  render(
    <I18nextProvider i18n={createI18n("en")}>
      <Stub initialEntries={["/settings/agents"]} />
      <Toaster />
    </I18nextProvider>,
  );
  return userEvent.setup();
}

describe("agent settings UI", () => {
  it("returns focus to the row menu trigger after editing from its portaled menu", async () => {
    const user = renderStory({ connections: [createAgentConnection()] });
    const trigger = await screen.findByRole("button", {
      name: "Actions for Test connection",
    });
    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "Edit" }));
    expect(
      screen.getByRole("heading", { name: "Edit connection" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });
  it("uses the delayed management placeholder while route navigation is pending", async () => {
    pending.mockReturnValue(true);
    renderStory({ connections: [] });
    expect(
      await screen.findByRole("status", { name: "Loading connections" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("opens a running login, polls its challenge, and reports polling failures inline", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        state: "awaiting_user",
        userCode: "SYNTHETIC",
        verificationUrl: "https://auth.openai.com/codex/device",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const original = createCliConnection();
    const story: AgentStory = { connections: [original] };
    const onAction = vi.fn((form: FormData): AgentActionResult => {
      const intent = String(form.get("intent"));
      if (original.cli)
        story.connections = [
          {
            ...original,
            cli: {
              ...original.cli,
              login:
                intent === "start-login"
                  ? { state: "starting" }
                  : { state: "cancelled", errorCode: "login_cancelled" },
            },
          },
        ];
      return { ok: true, intent };
    });
    const user = renderStory({
      ...story,
      get connections() {
        return story.connections;
      },
      onAction,
    });
    await user.click(await screen.findByRole("button", { name: "Configure" }));
    await user.click(screen.getByRole("button", { name: "Start sign-in" }));
    expect(await screen.findByText("SYNTHETIC")).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Check sign-in status" })[0],
    ).toBeDisabled();
    fetchMock.mockResolvedValue(new Response("Forbidden", { status: 403 }));
    expect(
      await screen.findByText(
        /Sign-in status could not be loaded/,
        {},
        { timeout: 3500 },
      ),
    ).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Cancel" })[0]);
    expect(
      await screen.findByRole("button", { name: "Sign in again" }),
    ).toBeInTheDocument();
    expect(onAction.mock.calls[1]?.[0].get("intent")).toBe("cancel-login");
  });

  it("offers the admin-mode switch without exposing tables or tools", async () => {
    const onAction = vi.fn((form: FormData): AgentActionResult => ({
      ok: true,
      intent: String(form.get("intent")),
    }));
    const user = renderStory({
      connections: [createAgentConnection()],
      access: "adminModeRequired",
      onAction,
    });
    await user.click(
      await screen.findByRole("button", { name: /administrator mode/i }),
    );
    // The notice names this area instead of the system settings.
    expect(
      screen.getByText(
        "The agent settings are only available in the admin mode. Your account is currently in the role mode.",
      ),
    ).toBeInTheDocument();
    expect(onAction.mock.calls[0]?.[0].get("mode")).toBe("admin");
    expect(screen.queryByText("Test connection")).toBeNull();
    expect(screen.queryByText("/synthetic/bin/codex")).toBeNull();
  });

  it("creates an API connection, preserves rejected input and clears saved secrets", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const story: AgentStory = { connections: [] };
    let attempts = 0;
    const onAction = vi.fn((form: FormData): AgentActionResult => {
      attempts++;
      if (attempts === 1)
        return { ok: false, intent: "create-connection", error: "name_taken" };
      story.connections = [
        createAgentConnection({
          name: String(form.get("name")),
          provider: "anthropic",
          testModel: String(form.get("testModel")) || null,
        }),
      ];
      return {
        ok: true,
        intent: String(form.get("intent")),
        connectionId: story.connections[0].id,
      };
    });
    const user = renderStory({
      ...story,
      get connections() {
        return story.connections;
      },
      onAction,
    });
    await user.click(
      await screen.findByRole("button", { name: "Add API connection" }),
    );
    await user.type(screen.getByLabelText("Name"), "Research");
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "Anthropic" }));
    await user.type(screen.getByLabelText("API key"), "synthetic-key");
    await user.click(
      screen.getByRole("button", { name: "Show current input" }),
    );
    expect(screen.getByLabelText("API key")).toHaveAttribute("type", "text");
    await user.click(
      screen.getByRole("button", { name: "Hide current input" }),
    );
    // Model and reasoning follow once the saved connection has access.
    expect(screen.queryByLabelText("Model ID")).toBeNull();
    expect(
      screen.getByText("Model and reasoning can be set up after saving."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    // A field error appears once at its field, not again as a block alert.
    expect(
      await screen.findByText("A connection already uses this name."),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("A connection already uses this name."),
    ).toHaveLength(1);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByLabelText("Name")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByLabelText("API key")).toHaveValue("synthetic-key");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByRole("heading", { name: "Edit connection" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeDisabled();
    expect(screen.queryByLabelText("API key")).toBeNull();
    expect(screen.getByText("API key stored")).toBeInTheDocument();
    expect(screen.getByText("Connection saved.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Replace key" }));
    expect(screen.getByLabelText("API key")).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onAction).toHaveBeenCalledTimes(3));
    expect(onAction.mock.calls[2]?.[0].get("apiKey")).toBe("");
    // A successful save closes the single-use replacement field again.
    await waitFor(() => expect(screen.queryByLabelText("API key")).toBeNull());
    expect(screen.getByText("API key stored")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows errors without a field as a block alert", async () => {
    const user = renderStory({
      connections: [],
      onAction: () => ({
        ok: false,
        intent: "create-connection",
        error: "connection_limit_reached",
      }),
    });
    await user.click(
      await screen.findByRole("button", { name: "Add API connection" }),
    );
    await user.type(screen.getByLabelText("Name"), "Too many");
    await user.type(screen.getByLabelText("API key"), "synthetic-secret");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "At most 50 connections can be stored.",
    );
    expect(screen.getByRole("alert")).toHaveClass("bg-destructive/5");
  });

  it("does not accept a catalog-action response as a connection save", async () => {
    const user = renderStory({
      connections: [],
      onAction: () => ({
        ok: true,
        intent: "refresh-catalog",
        connectionId: "unexpected",
      }),
    });
    await user.click(
      await screen.findByRole("button", { name: "Add API connection" }),
    );
    await user.type(screen.getByLabelText("Name"), "Unsaved");
    await user.type(screen.getByLabelText("API key"), "synthetic-secret");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled(),
    );
    expect(screen.getByLabelText("API key")).toHaveValue("synthetic-secret");
    expect(
      screen.getByRole("heading", { name: "Add connection" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Connection saved.")).toBeNull();
  });

  it("warns on dirty close, discards transient key input, and restores trigger focus", async () => {
    const user = renderStory({ connections: [createAgentConnection()] });
    const trigger = await screen.findByRole("button", {
      name: "Test connection",
    });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Replace key" }));
    await user.type(screen.getByLabelText("API key"), "synthetic-replacement");
    expect(screen.getByRole("button", { name: "Check access" })).toBeDisabled();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    confirm.mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Replace key" }));
    expect(screen.getByLabelText("API key")).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("runs explicit checks with inline results and requires model-test confirmation", async () => {
    const connection = createAgentConnection({
      testModel: "example-model",
      reasoningEffort: "high",
    });
    const story: AgentStory = { connections: [connection] };
    const onAction = vi.fn((form: FormData): AgentActionResult => {
      const kind = form.get("kind");
      if (kind === "auth" || kind === "model")
        story.connections = [
          {
            ...connection,
            checks: {
              ...story.connections[0].checks,
              [kind]: {
                status: "passed",
                errorCode: null,
                checkedAt: "2026-10-08T10:00:00Z",
                durationMs: 12,
                detail: { model: "example-model" },
              },
            },
          },
        ];
      return { ok: true, intent: "run-check" };
    });
    const user = renderStory({
      ...story,
      get connections() {
        return story.connections;
      },
      onAction,
    });
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Check access" }));
    expect(await screen.findByText("Passed")).toBeInTheDocument();
    expect(onAction).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Run model test" }));
    let dialog = screen.getByRole("dialog", { name: "Run model test?" });
    expect(dialog).toHaveTextContent("No Pages content is sent.");
    expect(dialog).toHaveTextContent("Reply with exactly: OK");
    expect(dialog).toHaveTextContent(
      "to example-model with reasoning effort “high”.",
    );
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Run model test" }));
    dialog = screen.getByRole("dialog", { name: "Run model test?" });
    await user.click(within(dialog).getByRole("button", { name: "Run test" }));
    await waitFor(() => expect(onAction).toHaveBeenCalledTimes(2));
    expect(onAction.mock.calls[1]?.[0].get("kind")).toBe("model");
    await user.type(screen.getByLabelText("Name"), " changed");
    expect(
      screen.getByRole("button", { name: "Run model test" }),
    ).toBeDisabled();
  });

  it("keeps failed removal inline and removes the row only after confirmed success", async () => {
    const story: AgentStory = { connections: [createAgentConnection()] };
    let succeeds = false;
    const onAction = vi.fn((): AgentActionResult => {
      if (!succeeds)
        return {
          ok: false,
          intent: "delete-connection",
          error: "credential_cleanup_failed",
        };
      story.connections = [];
      return { ok: true, intent: "delete-connection" };
    });
    const user = renderStory({
      ...story,
      get connections() {
        return story.connections;
      },
      onAction,
    });
    await user.click(
      await screen.findByRole("button", {
        name: "Actions for Test connection",
      }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Remove" }));
    let dialog = screen.getByRole("dialog", { name: "Remove connection?" });
    expect(dialog).toHaveTextContent("saved API key");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /credential directory/,
    );
    succeeds = true;
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    await user.click(screen.getByRole("button", { name: "Remove" }));
    dialog = screen.getByRole("dialog", { name: "Remove connection?" });
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("Connection removed.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByText("No API connections configured yet."),
    ).toBeInTheDocument();
  });

  it("creates CLI connections without a key and exposes their setup after saving", async () => {
    const story: AgentStory = { connections: [] };
    const onAction = vi.fn((form: FormData): AgentActionResult => {
      story.connections = [
        createCliConnection({
          name: String(form.get("name")),
          provider: "claude_code",
        }),
      ];
      return {
        ok: true,
        intent: "create-connection",
        connectionId: story.connections[0].id,
      };
    });
    const user = renderStory({
      ...story,
      get connections() {
        return story.connections;
      },
      onAction,
    });
    await user.click(
      await screen.findByRole("button", { name: "Add CLI connection" }),
    );
    expect(screen.queryByLabelText("API key")).toBeNull();
    expect(screen.queryByRole("button", { name: "Start sign-in" })).toBeNull();
    await user.type(screen.getByLabelText("Name"), "Claude test");
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: /Claude Code/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByRole("button", { name: "Start sign-in" }),
    ).toBeInTheDocument();
    expect(onAction.mock.calls[0]?.[0].get("provider")).toBe("claude_code");
  });

  it("shows a field error for a rejected key without losing the typed value", async () => {
    const user = renderStory({
      connections: [],
      onAction: () => ({
        ok: false,
        intent: "create-connection",
        error: "api_key_invalid_format",
      }),
    });
    await user.click(
      await screen.findByRole("button", { name: "Add API connection" }),
    );
    await user.type(screen.getByLabelText("Name"), "Example");
    await user.type(screen.getByLabelText("API key"), "has whitespace");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.getByLabelText("API key")).toHaveAttribute(
        "aria-invalid",
        "true",
      ),
    );
    expect(screen.getByLabelText("API key")).toHaveValue("has whitespace");
  });

  it("shows a field error for a rejected manual model ID without losing the typed value", async () => {
    // Z.AI has no model list, so its saved connection takes manual IDs.
    const user = renderStory({
      connections: [createAgentConnection({ provider: "zai" })],
      onAction: () => ({
        ok: false,
        intent: "update-connection",
        error: "test_model_invalid",
      }),
    });
    await user.click(
      await screen.findByRole("button", { name: "Test connection" }),
    );
    await user.type(screen.getByLabelText("Model ID"), "bad model");
    fireEvent.submit(
      screen.getByLabelText("Name").closest("form") as HTMLFormElement,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Model ID")).toHaveAttribute(
        "aria-invalid",
        "true",
      ),
    );
    expect(screen.getByLabelText("Model ID")).toHaveValue("bad model");
  });
});
