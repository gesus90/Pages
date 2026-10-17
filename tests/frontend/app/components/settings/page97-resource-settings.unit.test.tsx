import { act, fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AcpResourcesCard } from "@/app/components/settings/agents/acp-resources-card";
import { createI18n } from "@/app/lib/i18n";

import type { ComponentProps } from "react";
import type { SettingsActionData } from "@/app/lib/settings-actions/settings-action-support.server";
import type {
  AcpResourceDiagnostics,
  AcpResourceState,
} from "@/definition/AcpResource";

interface ResourceFetcherState {
  resources: AcpResourceDiagnostics | { readonly error: string } | undefined;
  result: SettingsActionData | undefined;
  state: "idle" | "submitting" | "loading";
  submitted: FormData | null;
  readonly load: ReturnType<typeof vi.fn>;
}

const fetcher = vi.hoisted((): ResourceFetcherState => ({
  resources: undefined,
  result: undefined,
  state: "idle",
  submitted: null,
  load: vi.fn(async () => {}),
}));

vi.mock("react-router", () => ({
  useFetcher: (options?: { readonly key: string }) => {
    if (options?.key === "acp-resources")
      return { data: fetcher.resources, load: fetcher.load };
    return {
      data: fetcher.result,
      state: fetcher.state,
      Form: ResourceForm,
    };
  },
}));

function ResourceForm(props: ComponentProps<"form">): React.ReactElement {
  return (
    <form
      {...props}
      onSubmit={(event) => {
        event.preventDefault();
        fetcher.submitted = new FormData(event.currentTarget);
      }}
    />
  );
}

function snapshot(limit = 2): AcpResourceDiagnostics {
  const states: readonly AcpResourceState[] = [
    "starting",
    "running",
    "idle",
    "closing",
    "cleanup_failed",
  ];
  return {
    options: {
      maxConcurrentAcpSessions: limit,
      memoryAwareScheduling: true,
      minimumAvailableMemory: 2048,
      acpIdleTimeout: 300000,
      queueDiscipline: "fifo",
    },
    limitSource: "config",
    availableMemory: 1024,
    problem: null,
    active: states.map((state) => ({
      instanceId: state,
      userId: "private-user",
      provider: "codex_cli",
      runId: state === "idle" ? null : `run-${state}`,
      stepId: null,
      state,
      isPaused: false,
      since: "2026-10-17",
    })),
    waiting: ["pica", "plan"].map((id) => ({
      instanceId: id,
      userId: "private-waiter",
      provider: "claude_code",
      runId: id === "pica" ? null : "other-plan",
      stepId: null,
      reason: "memory",
      since: "2026-10-17",
    })),
    leftovers: [],
  };
}

function card(
  canConfigure = true,
  locale: "de" | "en" = "de",
): React.ReactElement {
  return (
    <I18nextProvider i18n={createI18n(locale)}>
      <AcpResourcesCard canConfigure={canConfigure} />
    </I18nextProvider>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  fetcher.resources = snapshot();
  fetcher.result = undefined;
  fetcher.state = "idle";
  fetcher.submitted = null;
  fetcher.load.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

it("offers a labeled numeric system form and counts every global lease state and both Pica/plan waiters", () => {
  render(card());
  const input = screen.getByRole("spinbutton", {
    name: "Maximale ACP-Instanzen",
  });
  expect(input.getAttribute("min")).toBe("0");
  expect(input.getAttribute("max")).toBe("999");
  expect(input.getAttribute("step")).toBe("1");
  expect(
    screen.getByText("Belegt: 5 · Limit: 2 · Warteschlange: 2"),
  ).toBeTruthy();
  expect(screen.getByText(/Startet \(Kapazität reserviert\)/)).toBeTruthy();
  expect(screen.getByText(/Inaktiv \(Kapazität reserviert\)/)).toBeTruthy();
  expect(
    screen.getByText(/Bereinigung fehlgeschlagen oder unbestätigt/),
  ).toBeTruthy();
  expect(screen.getAllByText(/Wartet auf ausreichend RAM/)).toHaveLength(2);
  expect(document.body.textContent).not.toContain("private-user");
  expect(document.body.textContent).not.toContain("private-waiter");
});

it.each([0, 2, 999])(
  "submits limit %s with the explicit apply button to the system action",
  (limit) => {
    render(card());
    const input = screen.getByRole("spinbutton", {
      name: "Maximale ACP-Instanzen",
    });
    fireEvent.change(input, { target: { value: String(limit) } });
    const button = screen.getByRole("button", { name: "Übernehmen" });
    const form = button.closest("form");
    if (form === null) throw new Error("Expected system settings form");
    expect(form.getAttribute("action")).toBe("/settings/system");
    fireEvent.submit(form);
    expect(fetcher.submitted?.get("intent")).toBe("update-acp-resources");
    expect(fetcher.submitted?.get("maxConcurrentAcpSessions")).toBe(
      String(limit),
    );
  },
);

it.each(["de", "en"] as const)(
  "renders unlimited mode and complete localized source text in %s",
  (locale) => {
    fetcher.resources = snapshot(0);
    render(card(true, locale));
    const expected =
      locale === "de" ? "Unbegrenzt (max. 999)" : "Unlimited (max. 999)";
    expect(
      screen.getByText(new RegExp(expected.replace(/[().]/gu, "\\$&"), "u")),
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain(
      "settings.agents.resources.",
    );
    expect(document.body.textContent).not.toContain("0 Slots");
  },
);

it("disables editing under an environment override and displays the actual unlimited limit and source", () => {
  fetcher.resources = { ...snapshot(0), limitSource: "environment" };
  render(card());
  expect(screen.getByRole("spinbutton").hasAttribute("disabled")).toBe(true);
  expect(
    screen.getByRole("button", { name: "Übernehmen" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(
    screen.getByText(
      "Quelle: Umgebungsvariable PAGES_MAX_CONCURRENT_ACP_SESSIONS",
    ),
  ).toBeTruthy();
  expect(screen.getByText(/Änderungen sind hier gesperrt/)).toBeTruthy();
  expect(screen.getByText(/Limit: Unbegrenzt \(max\. 999\)/)).toBeTruthy();
});

it.each(["submitting", "loading"] as const)(
  "shows pending state %s while keeping the confirmed current limit",
  (state) => {
    fetcher.state = state;
    render(card());
    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("spinbutton").hasAttribute("disabled")).toBe(true);
    expect(
      screen.getAllByText("Wird gespeichert und angewendet …"),
    ).toHaveLength(2);
    expect(
      screen.getByText("Belegt: 5 · Limit: 2 · Warteschlange: 2"),
    ).toBeTruthy();
    expect(document.querySelector("form")?.getAttribute("aria-busy")).toBe(
      "true",
    );
  },
);

it.each(["invalidSetting", "environmentOverride", "general"] as const)(
  "announces %s without changing the actual displayed limit",
  (error) => {
    fetcher.result = { intent: "update-acp-resources", ok: false, error };
    render(card());
    expect(screen.getByRole("alert").textContent).toBe(
      createI18n("de").t(`settings.agents.resources.error.${error}`),
    );
    expect(screen.getByRole("spinbutton").getAttribute("aria-invalid")).toBe(
      "true",
    );
    expect(
      screen.getByText("Belegt: 5 · Limit: 2 · Warteschlange: 2"),
    ).toBeTruthy();
    expect(fetcher.load).toHaveBeenCalledTimes(1);
  },
);

it("immediately shows the acknowledged snapshot, reloads once, then follows subsequent polling and other admins", async () => {
  const view = render(card());
  fetcher.result = {
    intent: "update-acp-resources",
    ok: true,
    resources: { ...snapshot(3), active: [] },
  };
  view.rerender(card());
  expect(
    screen.getByText("ACP-Limit gespeichert und angewendet."),
  ).toBeTruthy();
  expect(
    screen.getByText("Belegt: 0 · Limit: 3 · Warteschlange: 2"),
  ).toBeTruthy();
  expect(fetcher.load).toHaveBeenCalledTimes(2);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(fetcher.load).toHaveBeenCalledTimes(3);
  fetcher.resources = { ...snapshot(1), waiting: [] };
  view.rerender(card());
  expect(
    screen.getByText("Belegt: 5 · Limit: 1 · Warteschlange: 0"),
  ).toBeTruthy();
  expect(fetcher.load).toHaveBeenCalledTimes(3);
  view.unmount();
  await vi.advanceTimersByTimeAsync(10000);
  expect(fetcher.load).toHaveBeenCalledTimes(3);
});

it("reuses the same status view without offering the system form in Agents", () => {
  render(card(false));
  expect(
    screen.getByText("Belegt: 5 · Limit: 2 · Warteschlange: 2"),
  ).toBeTruthy();
  expect(screen.queryByRole("spinbutton")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
});

it("updates the confirmed occupancy immediately while the router still revalidates the page", () => {
  const view = render(card());
  fetcher.state = "loading";
  fetcher.result = {
    intent: "update-acp-resources",
    ok: true,
    resources: { ...snapshot(3), active: [], waiting: [] },
  };
  view.rerender(card());
  expect(
    screen.getByText("Belegt: 0 · Limit: 3 · Warteschlange: 0"),
  ).toBeTruthy();
  expect(screen.getByRole("spinbutton").hasAttribute("disabled")).toBe(true);
  expect(fetcher.load).toHaveBeenCalledTimes(2);
});

it("reports unavailable status and removes the form when the protected polling endpoint refuses access", () => {
  fetcher.resources = { error: "forbidden" };
  render(card());
  expect(screen.getByRole("status").textContent).toBe(
    "Ressourcenstatus wird geladen oder ist nicht verfügbar.",
  );
  expect(screen.queryByRole("spinbutton")).toBeNull();
  expect(screen.queryByText(/private-user/)).toBeNull();
});
