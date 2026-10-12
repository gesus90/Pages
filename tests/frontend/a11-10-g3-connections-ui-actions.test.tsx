// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import {
  createMemoryRouter,
  createRoutesStub,
  RouterProvider,
} from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));
vi.mock("@/app/lib/auth.server", () => ({ getAuthenticatedUser: vi.fn() }));

import { useConnectionsActions } from "@/app/components/settings/connections/use-connections-actions";
import { Toaster } from "@/app/components/ui/toast";
import { createI18n } from "@/app/lib/i18n";
import SettingsConnectionsRoute, {
  ErrorBoundary,
} from "@/app/routes/settings-connections";

import type { McpConnectionsView } from "@/definition/McpConnections";
import type { ActionFunction } from "react-router";

const ONE_DAY = 86_400_000;
const idleView: McpConnectionsView = {
  origin: "https://pages.invalid",
  packageVersion: "0.1.0",
  validityDays: 30,
  tokens: [],
  oauth: { durationSeconds: null, grants: [] },
};
const endingView: McpConnectionsView = {
  ...idleView,
  oauth: {
    durationSeconds: null,
    grants: [
      {
        id: "grant",
        clientName: "HTTP Client",
        verifiedAt: Date.now() - 2 * ONE_DAY,
        expiresAt: null,
        status: "active",
      },
    ],
  },
};

let router: ReturnType<typeof createMemoryRouter> | undefined;
afterEach(() => {
  router?.dispose();
  router = undefined;
  vi.restoreAllMocks();
});

function Harness({
  view,
}: {
  readonly view: McpConnectionsView;
}): React.ReactElement {
  const actions = useConnectionsActions(view);
  return (
    <div>
      <button type="button" ref={actions.endedRef}>
        ended
      </button>
      <button
        type="button"
        onClick={() =>
          actions.choose({
            intent: "revoke-token",
            id: "paired",
            name: "Laptop",
          })
        }
      >
        choose revoke
      </button>
      <button
        type="button"
        onClick={() =>
          actions.choose({
            intent: "request-rotation",
            id: "paired",
            name: "Laptop",
          })
        }
      >
        choose rotation
      </button>
      <button
        type="button"
        onClick={() =>
          actions.choose({
            intent: "revoke-oauth-grant",
            id: "grant",
            name: "HTTP Client",
          })
        }
      >
        choose grant
      </button>
      <button type="button" onClick={() => actions.duration("604800")}>
        duration week
      </button>
      <button type="button" onClick={() => actions.duration("3600")}>
        duration hour
      </button>
      <button type="button" onClick={() => actions.duration("unlimited")}>
        duration unlimited
      </button>
      <button type="button" onClick={() => actions.validity("7")}>
        validity
      </button>
      <button type="button" onClick={actions.confirm}>
        confirm
      </button>
      <button type="button" onClick={actions.cancel}>
        cancel
      </button>
      <output aria-label="selected">{JSON.stringify(actions.selected)}</output>
      <output aria-label="error">{actions.error ?? "none"}</output>
      <output aria-label="pending">{String(actions.pending)}</output>
    </div>
  );
}

function renderHarness(
  action: ActionFunction,
  view: McpConnectionsView = idleView,
): ReturnType<typeof userEvent.setup> {
  router = createMemoryRouter([
    {
      path: "/",
      element: <Harness view={view} />,
      loader: () => ({}),
      action,
      hydrateFallbackElement: <p>Loading</p>,
    },
  ]);
  render(
    <I18nextProvider i18n={createI18n("en")}>
      <RouterProvider router={router} />
      <Toaster />
    </I18nextProvider>,
  );
  return userEvent.setup();
}

async function formOf(
  action: ReturnType<typeof vi.fn<ActionFunction>>,
  call = 0,
): Promise<Record<string, FormDataEntryValue>> {
  const form = await action.mock.calls[call][0].request.formData();
  return Object.fromEntries(form);
}

function selected(): string {
  return screen.getByLabelText("selected").textContent;
}

describe("A11.10 connection actions: direct changes", () => {
  it("saves the personal validity and announces the generic success", async () => {
    const action = vi.fn<ActionFunction>().mockResolvedValue({ updated: true });
    const user = renderHarness(action);
    await user.click(await screen.findByRole("button", { name: "validity" }));
    expect(await screen.findByText("Settings saved.")).toBeInTheDocument();
    expect(await formOf(action)).toEqual({
      intent: "set-token-duration",
      days: "7",
    });
    expect(screen.getByLabelText("pending")).toHaveTextContent("false");
    expect(selected()).toBe("null");
  });

  it("reports pending while the server works and keeps a rejected validity as an error", async () => {
    let release: () => void = () => undefined;
    const action = vi.fn<ActionFunction>().mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ error: "invalid_request" });
        }),
    );
    const user = renderHarness(action);
    await user.click(await screen.findByRole("button", { name: "validity" }));
    await waitFor(() =>
      expect(screen.getByLabelText("pending")).toHaveTextContent("true"),
    );
    release();
    await waitFor(() =>
      expect(screen.getByLabelText("error")).toHaveTextContent(
        "invalid_request",
      ),
    );
    expect(screen.getByLabelText("pending")).toHaveTextContent("false");
    expect(screen.queryByText("Settings saved.")).not.toBeInTheDocument();
  });

  it("submits a duration that ends no grant without a confirmation", async () => {
    const action = vi.fn<ActionFunction>().mockResolvedValue({ updated: true });
    const user = renderHarness(action, endingView);
    await user.click(
      await screen.findByRole("button", { name: "duration unlimited" }),
    );
    expect(await screen.findByText("Settings saved.")).toBeInTheDocument();
    expect(await formOf(action)).toEqual({
      intent: "set-oauth-duration",
      duration: "unlimited",
    });
    expect(selected()).toBe("null");
  });

  it("does nothing visible for a response without error or update", async () => {
    const action = vi.fn<ActionFunction>().mockResolvedValue({});
    const user = renderHarness(action);
    await user.click(await screen.findByRole("button", { name: "validity" }));
    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.getByLabelText("pending")).toHaveTextContent("false"),
    );
    expect(screen.getByLabelText("error")).toHaveTextContent("none");
    expect(selected()).toBe("null");
    expect(screen.queryByText("Settings saved.")).not.toBeInTheDocument();
  });
});

describe("A11.10 connection actions: server confirmation", () => {
  it("turns a required confirmation of a duration change into a selected action", async () => {
    const action = vi
      .fn<ActionFunction>()
      .mockResolvedValue({ error: "confirmation_required", count: 2 });
    const user = renderHarness(action);
    await user.click(
      await screen.findByRole("button", { name: "duration week" }),
    );
    await waitFor(() =>
      expect(JSON.parse(selected())).toEqual({
        intent: "set-oauth-duration",
        duration: "604800",
        count: 2,
      }),
    );
    expect(screen.getByLabelText("error")).toHaveTextContent("none");
  });

  it("shows a required confirmation as an error when no duration change asked for it", async () => {
    const action = vi
      .fn<ActionFunction>()
      .mockResolvedValue({ error: "confirmation_required", count: 2 });
    const user = renderHarness(action);
    await user.click(await screen.findByRole("button", { name: "validity" }));
    await waitFor(() =>
      expect(screen.getByLabelText("error")).toHaveTextContent(
        "confirmation_required",
      ),
    );
    expect(selected()).toBe("null");
  });

  it("asks locally before a shortening ends active grants and sends the confirmation flag", async () => {
    const action = vi.fn<ActionFunction>().mockResolvedValue({ updated: true });
    const user = renderHarness(action, endingView);
    await user.click(
      await screen.findByRole("button", { name: "duration hour" }),
    );
    expect(JSON.parse(selected())).toEqual({
      intent: "set-oauth-duration",
      duration: "3600",
      count: 1,
    });
    expect(action).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "confirm" }));
    expect(await screen.findByText("Settings saved.")).toBeInTheDocument();
    expect(await formOf(action)).toEqual({
      intent: "set-oauth-duration",
      duration: "3600",
      confirmShorten: "on",
    });
    expect(selected()).toBe("null");
  });
});

describe("A11.10 connection actions: confirmed mutations", () => {
  it.each([
    ["choose revoke", "revoke-token", "Connection revoked."],
    ["choose rotation", "request-rotation", "Rotation requested."],
    ["choose grant", "revoke-oauth-grant", "Grant revoked."],
  ])(
    "submits %s with the chosen identifier and announces its own success",
    async (choose, intent, message) => {
      const action = vi
        .fn<ActionFunction>()
        .mockResolvedValue({ updated: true });
      const user = renderHarness(action);
      await user.click(await screen.findByRole("button", { name: choose }));
      expect(JSON.parse(selected())).toMatchObject({ intent });
      await user.click(screen.getByRole("button", { name: "confirm" }));
      expect(await screen.findByText(message)).toBeInTheDocument();
      const submitted = await formOf(action);
      expect(submitted.intent).toBe(intent);
      expect(submitted.id).toBe(
        intent === "revoke-oauth-grant" ? "grant" : "paired",
      );
      expect(selected()).toBe("null");
    },
  );

  it("moves focus to the ended connections after a revocation, and only then", async () => {
    const action = vi.fn<ActionFunction>().mockResolvedValue({ updated: true });
    const user = renderHarness(action);
    await user.click(
      await screen.findByRole("button", { name: "choose rotation" }),
    );
    await user.click(screen.getByRole("button", { name: "confirm" }));
    await screen.findByText("Rotation requested.");
    expect(screen.getByRole("button", { name: "ended" })).not.toHaveFocus();

    await user.click(screen.getByRole("button", { name: "choose revoke" }));
    await user.click(screen.getByRole("button", { name: "confirm" }));
    await screen.findByText("Connection revoked.");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "ended" })).toHaveFocus(),
    );
  });

  it("keeps the selection and reports the error when the server refuses", async () => {
    const action = vi
      .fn<ActionFunction>()
      .mockResolvedValue({ error: "access_denied" });
    const user = renderHarness(action);
    await user.click(
      await screen.findByRole("button", { name: "choose revoke" }),
    );
    await user.click(screen.getByRole("button", { name: "confirm" }));
    await waitFor(() =>
      expect(screen.getByLabelText("error")).toHaveTextContent("access_denied"),
    );
    expect(JSON.parse(selected())).toMatchObject({ intent: "revoke-token" });
  });

  it("sends nothing when confirming without a selection and clears a selection on cancel", async () => {
    const action = vi.fn<ActionFunction>().mockResolvedValue({ updated: true });
    const user = renderHarness(action);
    await user.click(await screen.findByRole("button", { name: "confirm" }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(action).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "choose revoke" }));
    expect(selected()).not.toBe("null");
    await user.click(screen.getByRole("button", { name: "cancel" }));
    expect(selected()).toBe("null");
  });
});

describe("A11.10 settings connections route component", () => {
  const routeView: McpConnectionsView = {
    ...idleView,
    tokens: [
      {
        id: "paired",
        userId: "owner",
        name: "Laptop",
        source: "pairing",
        device: null,
        createdAt: Date.now(),
        lastUsedAt: null,
        expiresAt: null,
        revokedAt: null,
        rotatedAt: null,
        rotationRequestedAt: null,
        status: "active",
      },
    ],
  };

  function renderRoute(loader: () => McpConnectionsView): void {
    const Stub = createRoutesStub([
      {
        path: "/settings/connections",
        Component: SettingsConnectionsRoute,
        ErrorBoundary,
        loader,
      },
    ]);
    render(
      <I18nextProvider i18n={createI18n("en")}>
        <Stub initialEntries={["/settings/connections"]} />
      </I18nextProvider>,
    );
  }

  it("renders the loaded connections", async () => {
    renderRoute(() => routeView);
    expect(
      await screen.findByRole("heading", { name: "Connections" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Actions for Laptop" }),
    ).toBeInTheDocument();
  });

  it("explains a failed load and loads again on retry", async () => {
    const loader = vi
      .fn<() => McpConnectionsView>()
      .mockImplementationOnce(() => {
        throw new Response("failed", { status: 500 });
      })
      .mockImplementation(() => routeView);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderRoute(loader);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Connections could not be loaded.",
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("button", { name: "Actions for Laptop" }),
    ).toBeInTheDocument();
    expect(loader).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
