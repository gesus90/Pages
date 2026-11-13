import { fireEvent, render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { expect, it } from "vitest";
import { AcpLeaseList } from "@/app/components/settings/agents/acp-resources/acp-lease-list";
import { createI18n } from "@/app/lib/i18n";
import type { AcpResourceDiagnostics } from "@/definition/AcpResource";

function resources(): AcpResourceDiagnostics {
  const active: AcpResourceDiagnostics["active"] = Array.from(
    { length: 48 },
    (_, index) => ({
      instanceId: `instance-${index}`,
      userId: "user",
      provider: "codex_cli",
      runId: null,
      stepId: null,
      since: "2026-11-13T10:00:00.000Z",
      state: index < 3 ? "cleanup_failed" : "running",
      isPaused: false,
    }),
  );
  return {
    active,
    waiting: [],
    leftovers: [],
    options: {
      maxConcurrentAcpSessions: 50,
      memoryAwareScheduling: false,
      minimumAvailableMemory: 0,
      queueDiscipline: "fifo",
    },
    limitSource: "config",
    availableMemory: null,
    problem: null,
  };
}

it("bounds the list, bundles warnings, filters and expands details", () => {
  const { container } = render(
    <I18nextProvider i18n={createI18n("de")}>
      <MemoryRouter>
        <AcpLeaseList resources={resources()} />
      </MemoryRouter>
    </I18nextProvider>,
  );
  const panel = container.querySelector("[data-scroll-area]");
  expect(panel?.className).toContain("max-h-[440px]");
  expect(panel?.querySelector(".overflow-y-auto")).not.toBeNull();
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.getByRole("status").textContent).toContain(
    "3 Reservierungen unbestätigt",
  );
  fireEvent.click(screen.getByRole("button", { name: /Unbestätigt 3/ }));
  const rows = screen.getAllByRole("button", { name: "Technische Details" });
  expect(rows).toHaveLength(3);
  expect(screen.queryByText(/instance-0/)).toBeNull();
  expect(
    container.querySelectorAll(".bg-warning-subtle.text-warning").length,
  ).toBeGreaterThanOrEqual(3);
  fireEvent.click(rows[0]);
  expect(rows[0].getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByText(/Instanz-ID: instance-0/)).toBeTruthy();
  expect(within(panel as HTMLElement).getAllByText("Unbestätigt")).toHaveLength(
    3,
  );
});

it("shows each state badge with its semantic colors and no notice without unconfirmed entries", () => {
  const initial = resources();
  const base = initial.active[0];
  if (!base) throw new Error("Missing fixture");
  const active: AcpResourceDiagnostics["active"] = [
    { ...base, instanceId: "running", state: "running" },
    { ...base, instanceId: "starting", state: "starting" },
    { ...base, instanceId: "closing", state: "closing" },
    { ...base, instanceId: "idle", state: "idle" },
    { ...base, instanceId: "paused", state: "idle", isPaused: true },
  ];
  const waiting: AcpResourceDiagnostics["waiting"] = [
    {
      instanceId: "waiting",
      userId: "user",
      provider: "codex_cli",
      runId: null,
      stepId: null,
      since: base.since,
      reason: "capacity",
    },
  ];
  render(
    <I18nextProvider i18n={createI18n("de")}>
      <MemoryRouter>
        <AcpLeaseList resources={{ ...initial, active, waiting }} />
      </MemoryRouter>
    </I18nextProvider>,
  );
  expect(screen.queryByRole("status")).toBeNull();
  for (const [label, classes] of [
    ["Läuft", "bg-info-subtle text-info"],
    ["Startet", "bg-status-active-subtle text-status-active"],
    ["Wird beendet", "bg-status-active-subtle text-status-active"],
    ["Inaktiv", "bg-muted text-muted-foreground"],
    ["Pausiert", "bg-muted text-foreground"],
    ["Wartet", "bg-muted text-muted-foreground"],
  ]) {
    const badge = screen.getByText(label);
    for (const name of classes.split(" "))
      expect(badge.classList.contains(name)).toBe(true);
  }
});
