// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import { renderToString } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";

import { PairingForm } from "@/app/components/pairing/pairing-form";
import { PairingEntry } from "@/app/components/pairing/pairing-entry";
import { PairingState } from "@/app/components/pairing/pairing-state";
import { ConnectionsPanel } from "@/app/components/settings/connections/connections-panel";
import { ConnectionTime } from "@/app/components/settings/connections/connection-time";
import { RegionProvider } from "@/app/components/common/region-provider";
import { createI18n } from "@/app/lib/i18n";
import { LANGUAGE } from "@/language/Language";

import type { McpConnectionsView } from "@/definition/McpConnections";
import type { McpPairingView } from "@/definition/McpPairing";
import type { ActionFunction } from "react-router";
import type { Language } from "@/language/Language";

const pairing: McpPairingView = {
  status: "pending",
  code: "BCDF-GHJK",
  csrf: "safe-nonce",
  clientName: "Pages MCP",
  device: "laptop",
  packageVersion: "0.1.0",
  requestedAt: Date.now(),
  expiresAt: Date.now() + 600_000,
  validityDays: 30,
  account: { displayName: "Test User", username: "test", isAdmin: true },
};
const connections: McpConnectionsView = {
  origin: "https://pages.invalid:4567",
  packageVersion: "0.1.0",
  validityDays: 30,
  tokens: [
    {
      id: "paired",
      userId: "owner",
      name: "Laptop",
      source: "pairing",
      device: "laptop",
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      expiresAt: null,
      revokedAt: null,
      rotatedAt: null,
      rotationRequestedAt: null,
      status: "active",
    },
  ],
  oauth: {
    durationSeconds: null,
    grants: [
      {
        id: "grant",
        clientName: "HTTP Client",
        verifiedAt: Date.now() - 3 * 86_400_000,
        expiresAt: null,
        status: "active",
      },
    ],
  },
};
let router: ReturnType<typeof createMemoryRouter> | undefined;
afterEach(() => {
  router?.dispose();
  vi.useRealTimers();
});

function renderPage(
  element: React.ReactElement,
  action: ActionFunction = () => ({ updated: true }),
  language: Language = LANGUAGE.GERMAN,
): void {
  router = createMemoryRouter([
    {
      path: "/",
      element,
      loader: () => ({}),
      action,
      hydrateFallbackElement: <p>Laden</p>,
    },
  ]);
  render(
    <I18nextProvider i18n={createI18n(language)}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

describe("A11.2 connection times", () => {
  it("renders stable region-formatted server times and recent hours after hydration", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-11T22:00:00Z"));
    const timestamp = new Date("2026-10-11T12:00:00Z").getTime();
    const content = (
      <I18nextProvider i18n={createI18n(LANGUAGE.GERMAN)}>
        <RegionProvider
          region={{ dateFormat: "YYYY-MM-DD", timezone: "Europe/Berlin" }}
        >
          <ConnectionTime time={timestamp} />
          <ConnectionTime time={timestamp} unlimited />
        </RegionProvider>
      </I18nextProvider>
    );
    const serverMarkup = renderToString(content);
    expect(serverMarkup).toContain("2026-10-11 14:00");
    expect(serverMarkup).not.toContain("vor 10 Stunden");
    render(content);
    const relative = await screen.findByText("vor 10 Stunden");
    expect(relative).toHaveAttribute("title", "2026-10-11 14:00");
    expect(relative).toHaveAttribute("dateTime", "2026-10-11T12:00:00.000Z");
    expect(screen.getByText("2026-10-11 14:00")).toHaveAttribute(
      "title",
      "2026-10-11 14:00",
    );
  });
});

describe("A11.2 deliberate browser approval", () => {
  it("never approves on Enter or without matching the code and submits the chosen whole-day validity", async () => {
    const action = vi.fn<ActionFunction>().mockResolvedValue({ updated: true });
    renderPage(<PairingForm view={pairing} />, action);
    const user = userEvent.setup();
    const name = await screen.findByLabelText("Name der Verbindung");
    expect(name).toHaveValue("Pages MCP auf laptop");
    expect(screen.getByLabelText("Gültigkeit in Tagen")).toHaveValue(30);
    await user.click(name);
    await user.keyboard("{Enter}");
    expect(action).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Verbinden" }));
    expect(
      await screen.findByText("Bitte bestätigen Sie den Code-Vergleich."),
    ).toBeInTheDocument();
    expect(action).not.toHaveBeenCalled();
    await user.click(screen.getByRole("checkbox"));
    await user.clear(name);
    await user.click(screen.getByRole("button", { name: "Verbinden" }));
    expect(
      await screen.findByText("Bitte einen Namen eingeben."),
    ).toBeInTheDocument();
    await user.type(name, "My laptop");
    await user.clear(screen.getByLabelText("Gültigkeit in Tagen"));
    await user.type(screen.getByLabelText("Gültigkeit in Tagen"), "0");
    await user.click(screen.getByRole("button", { name: "Verbinden" }));
    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    const form = await action.mock.calls[0][0].request.formData();
    expect(Object.fromEntries(form)).toMatchObject({
      decision: "approve",
      confirmMatch: "on",
      validityDays: "0",
      name: "My laptop",
      code: pairing.code,
      csrf: pairing.csrf,
    });
  });

  it("allows denial without checking or naming and renders announced terminal states", async () => {
    const action = vi.fn<ActionFunction>().mockResolvedValue({ updated: true });
    renderPage(<PairingForm view={pairing} />, action);
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Ablehnen" }));
    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    expect(
      (await action.mock.calls[0][0].request.formData()).get("decision"),
    ).toBe("deny");
  });

  it.each([
    "approved",
    "consumed",
    "denied",
    "cancelled",
    "expired",
    "invalid",
  ] as const)(
    "renders %s without secrets and only appropriate actions",
    async (status) => {
      renderPage(<PairingState view={{ ...pairing, status }} />);
      expect(
        await screen.findByRole("heading", { level: 1 }),
      ).toBeInTheDocument();
      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Verbinden" }),
      ).not.toBeInTheDocument();
      expect(document.body.textContent).not.toContain("mcpPairing.");
    },
  );

  it("announces a browser lock and disables code submission", async () => {
    renderPage(<PairingEntry retryAfter={900} />);
    const code = await screen.findByLabelText("Pairing-Code");
    expect(code).toHaveAttribute("aria-invalid", "true");
    expect(code).toHaveAccessibleDescription(/15 Minuten/);
    expect(screen.getByRole("button", { name: "Weiter" })).toBeDisabled();
  });
});

describe("A11.2 connection management", () => {
  it("opens the guide from the empty state with the instance and port and without a token", async () => {
    renderPage(<ConnectionsPanel view={{ ...connections, tokens: [] }} />);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Anleitung anzeigen" }),
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(
      "node pages-mcp-v0.1.0.js pair --url https://pages.invalid:4567",
    );
    expect(dialog).toHaveTextContent("PAGES_URL");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("confirms rotation and revocation, keeps failed mutations open, and labels the metadata", async () => {
    const action = vi
      .fn<ActionFunction>()
      .mockResolvedValue({ error: "access_denied" });
    renderPage(<ConnectionsPanel view={connections} />, action);
    const user = userEvent.setup();
    expect(
      await screen.findByRole("columnheader", { name: "Name" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("columnheader", { name: "Gültig bis" }),
    ).toHaveLength(2);
    await user.click(
      screen.getByRole("button", { name: "Aktionen für Laptop" }),
    );
    await user.click(
      screen.getByRole("menuitem", { name: "Rotation anfordern …" }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("Laptop");
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Abbrechen",
      }),
    );
    expect(action).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Aktionen für Laptop" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Widerrufen …" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Widerrufen",
      }),
    );
    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Die Änderung konnte nicht gespeichert werden",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect((await action.mock.calls[0][0].request.formData()).get("id")).toBe(
      "paired",
    );
  });

  it("does not offer rotation for manual tokens and keeps ended entries expandable", async () => {
    const manual = { ...connections.tokens[0], source: "manual" as const };
    const ended = {
      ...manual,
      id: "ended",
      name: "Old",
      revokedAt: Date.now(),
      status: "revoked" as const,
    };
    renderPage(
      <ConnectionsPanel view={{ ...connections, tokens: [manual, ended] }} />,
    );
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Aktionen für Laptop" }),
    );
    expect(
      screen.queryByRole("menuitem", { name: "Rotation anfordern …" }),
    ).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    const expand = screen.getByRole("button", {
      name: "Beendete Verbindungen (1)",
    });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    await user.click(expand);
    expect(screen.getByText("Old")).toBeVisible();
    expect(screen.getByText("Widerrufen")).toBeVisible();
  });

  it("confirms an OAuth reduction before submitting and renders English without missing keys", async () => {
    const action = vi.fn<ActionFunction>().mockResolvedValue({ updated: true });
    renderPage(
      <ConnectionsPanel view={connections} />,
      action,
      LANGUAGE.ENGLISH,
    );
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("combobox", { name: "Confirm again after" }),
    );
    await user.click(screen.getByRole("option", { name: "1 days" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("1");
    expect(action).not.toHaveBeenCalled();
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Shorten",
      }),
    );
    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    expect(
      Object.fromEntries(await action.mock.calls[0][0].request.formData()),
    ).toMatchObject({
      intent: "set-oauth-duration",
      duration: "86400",
      confirmShorten: "on",
    });
    expect(document.body.textContent).not.toContain("settings.connections.");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
});
