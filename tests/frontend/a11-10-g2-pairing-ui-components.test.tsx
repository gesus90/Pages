// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PairingEntry } from "@/app/components/pairing/pairing-entry";
import { PairingForm } from "@/app/components/pairing/pairing-form";
import { PairingRequestSummary } from "@/app/components/pairing/pairing-request-summary";
import { PairingState } from "@/app/components/pairing/pairing-state";
import { createI18n } from "@/app/lib/i18n";
import PairRoute, { ErrorBoundary } from "@/app/routes/pair";

import type { McpPairingView } from "@/definition/McpPairing";
import type { ActionFunction } from "react-router";

const account = { displayName: "Test User", username: "test", isAdmin: false };
const pending: McpPairingView = {
  status: "pending",
  code: "BCDF-GHJK",
  csrf: "safe-nonce",
  clientName: "Pages MCP",
  device: "laptop",
  packageVersion: "0.1.0",
  requestedAt: Date.now(),
  expiresAt: Date.now() + 600_000,
  validityDays: 30,
  account,
};
const entry: McpPairingView = { status: "entry", code: "", account };
const POLL_INTERVAL = 2000;

let router: ReturnType<typeof createMemoryRouter> | undefined;
afterEach(() => {
  router?.dispose();
});

function renderRoute(
  element: React.ReactElement,
  options: {
    readonly loader?: () => unknown;
    readonly action?: ActionFunction;
  } = {},
): void {
  router = createMemoryRouter([
    {
      path: "/",
      element,
      loader: options.loader ?? (() => ({})),
      action: options.action,
      hydrateFallbackElement: <p>Loading</p>,
    },
  ]);
  render(
    <I18nextProvider i18n={createI18n("en")}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

/**
 * Returns the callback registered by the most recent timer with this delay.
 *
 * @remarks
 * Effects register their timers after the commit that shows the label a test
 * waits for, so the timer is awaited instead of read at once.
 */
async function latestTimerCallback(
  spy: { readonly mock: { readonly calls: readonly unknown[][] } },
  delay: number,
): Promise<() => void> {
  const callback = await waitFor(
    () => {
      const call = spy.mock.calls
        .filter((entryCall) => entryCall[1] === delay)
        .at(-1);
      const registered = call?.[0];
      if (typeof registered !== "function")
        throw new Error(`No timer with a delay of ${delay} ms`);
      return registered;
    },
    { timeout: 10_000 },
  );
  return () => {
    act(() => {
      callback();
    });
  };
}

describe("A11.10 pairing route composition", () => {
  it("shows the approval form with a heading for a pending request and no code entry", async () => {
    renderRoute(<PairRoute />, { loader: () => pending });
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Connect MCP client",
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Connection name")).toHaveValue(
      "Pages MCP on laptop",
    );
    expect(screen.queryByLabelText("Pairing code")).not.toBeInTheDocument();
  });

  it.each([entry, { ...entry, status: "invalid" as const }])(
    "offers the code entry for a $status view",
    async (view) => {
      renderRoute(<PairRoute />, { loader: () => view });
      expect(await screen.findByLabelText("Pairing code")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Continue" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByLabelText("Connection name"),
      ).not.toBeInTheDocument();
    },
  );

  it("describes the entry state without a status line", async () => {
    renderRoute(<PairRoute />, { loader: () => entry });
    expect(
      await screen.findByText(
        "Enter the code shown by the pairing command in your terminal.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps terminal states free of code entry", async () => {
    renderRoute(<PairRoute />, {
      loader: () => ({ ...pending, status: "denied" }),
    });
    expect(
      await screen.findByRole("link", { name: "Go to dashboard" }),
    ).toHaveAttribute("href", "/dashboard");
    expect(screen.queryByLabelText("Pairing code")).not.toBeInTheDocument();
  });

  it("keeps an unexpected route failure inside the card with an alert and a way to enter a code", async () => {
    renderRoute(<ErrorBoundary />);
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Connect MCP client",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The decision could not be saved. Please try again.",
    );
    expect(screen.getByLabelText("Pairing code")).toBeInTheDocument();
  });
});

describe("A11.10 pairing state polling", () => {
  it("revalidates an approved request while it waits for its device", async () => {
    const intervals = vi.spyOn(window, "setInterval");
    const loader = vi.fn(() => ({}));
    renderRoute(<PairingState view={{ ...pending, status: "approved" }} />, {
      loader,
    });
    expect(await screen.findByText("Waiting for the client …")).toBeVisible();
    expect(loader).toHaveBeenCalledTimes(1);
    (await latestTimerCallback(intervals, POLL_INTERVAL))();
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
  });

  it("does not start another revalidation while one is still running", async () => {
    const intervals = vi.spyOn(window, "setInterval");
    let finish: (value: unknown) => void = () => undefined;
    const loader = vi
      .fn<() => unknown>()
      .mockReturnValueOnce({})
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      )
      .mockReturnValue({});
    renderRoute(<PairingState view={{ ...pending, status: "approved" }} />, {
      loader,
    });
    expect(await screen.findByText("Waiting for the client …")).toBeVisible();
    (await latestTimerCallback(intervals, POLL_INTERVAL))();
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(router?.state.revalidation).toBe("loading"));
    (await latestTimerCallback(intervals, POLL_INTERVAL))();
    expect(loader).toHaveBeenCalledTimes(2);
    finish({});
    await waitFor(() => expect(router?.state.revalidation).toBe("idle"));
  });

  it("does not poll for a request that is not waiting", async () => {
    const intervals = vi.spyOn(window, "setInterval");
    renderRoute(<PairingState view={{ ...pending, status: "denied" }} />);
    expect(
      await screen.findByRole("link", { name: "Go to dashboard" }),
    ).toBeVisible();
    expect(
      intervals.mock.calls.filter((call) => call[1] === POLL_INTERVAL),
    ).toEqual([]);
  });
});

describe("A11.10 pairing form timing and results", () => {
  it("revalidates the open request regularly but not while a decision is being sent", async () => {
    const intervals = vi.spyOn(window, "setInterval");
    const loader = vi.fn(() => ({}));
    let release: (value: unknown) => void = () => undefined;
    const action = vi.fn<ActionFunction>(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderRoute(<PairingForm view={pending} />, { loader, action });
    const deny = await screen.findByRole("button", { name: "Deny" });
    (await latestTimerCallback(intervals, POLL_INTERVAL))();
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
    await userEvent.setup().click(deny);
    await waitFor(() => expect(deny).toBeDisabled());
    const afterSubmit = loader.mock.calls.length;
    (await latestTimerCallback(intervals, POLL_INTERVAL))();
    expect(loader).toHaveBeenCalledTimes(afterSubmit);
    release({ updated: true });
    await waitFor(() => expect(deny).toBeEnabled());
  });

  it("replaces an expired request with the expiry notice and removes the approval controls", async () => {
    renderRoute(<PairingForm view={{ ...pending, expiresAt: undefined }} />);
    expect(
      await screen.findByText(
        "The code has expired. Start pairing again in the terminal.",
      ),
    ).toHaveAttribute("role", "status");
    expect(
      screen.queryByRole("button", { name: "Connect" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Connection name")).not.toBeInTheDocument();
  });

  it("uses thirty days without a stored preference, hides the admin note and reports a failed decision", async () => {
    const action = vi
      .fn<ActionFunction>()
      .mockResolvedValue({ error: "access_denied" });
    renderRoute(
      <PairingForm view={{ ...pending, validityDays: undefined }} />,
      { action },
    );
    expect(await screen.findByLabelText("Validity in days")).toHaveValue(30);
    expect(
      screen.queryByText(/Your admin permission applies/),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Deny" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The decision could not be saved. Please try again.",
    );
  });

  it("explains the admin permission for an administrator", async () => {
    renderRoute(
      <PairingForm
        view={{ ...pending, account: { ...account, isAdmin: true } }}
      />,
    );
    expect(
      await screen.findByText(/Your admin permission applies via MCP/),
    ).toBeVisible();
  });
});

describe("A11.10 pairing entry", () => {
  it("announces a malformed code returned by the action", async () => {
    const action = vi
      .fn<ActionFunction>()
      .mockResolvedValue({ error: "invalid_code" });
    renderRoute(<PairingEntry />, { action });
    const code = await screen.findByLabelText("Pairing code");
    expect(code).not.toHaveAttribute("aria-invalid", "true");
    const user = userEvent.setup();
    await user.type(code, "abc");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    expect(
      (await action.mock.calls[0][0].request.formData()).get("intent"),
    ).toBe("enter-code");
    expect(code).toHaveAccessibleDescription(/Enter the eight-letter code\./);
    expect(code).toHaveAttribute("aria-invalid", "true");
  });

  it("locks the field with the remaining minutes and reloads once the lock has passed", async () => {
    const timeouts = vi.spyOn(window, "setTimeout");
    const loader = vi.fn(() => ({}));
    renderRoute(<PairingEntry retryAfter={120} />, { loader });
    const code = await screen.findByLabelText("Pairing code");
    expect(code).toHaveAccessibleDescription(/Try again in 2 minutes\./);
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(loader).toHaveBeenCalledTimes(1);
    (await latestTimerCallback(timeouts, 120_000))();
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
  });

  it("stays editable without a lock", async () => {
    renderRoute(<PairingEntry />);
    const code = await screen.findByLabelText("Pairing code");
    expect(code).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });
});

describe("A11.10 pairing request summary with unknown timestamps", () => {
  it("shows the epoch for a missing expiry and a dash for a missing request time", async () => {
    renderRoute(
      <PairingRequestSummary
        view={{
          ...pending,
          requestedAt: undefined,
          expiresAt: undefined,
        }}
      />,
    );
    expect(await screen.findByText(/Valid until .*19(69|70)/)).toBeVisible();
    const requested = screen.getByText("Requested");
    expect(requested.parentElement).toHaveTextContent("—");
  });
});
