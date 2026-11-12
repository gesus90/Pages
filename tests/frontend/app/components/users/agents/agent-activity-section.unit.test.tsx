import { render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { expect, it } from "vitest";

import { AgentActivitySection } from "@/app/components/users/agents/agent-activity-section";
import { createI18n } from "@/app/lib/i18n";

import { activityEntry } from "./agent-detail-fixture";

import type {
  AgentActivityEntry,
  AgentCostState,
} from "@/definition/AgentEmployee";

const i18n = createI18n("de");
const COST: AgentCostState = {
  spent: 1.5,
  unknownSessions: 0,
  month: "2026-11",
};

function renderSection(
  entries: readonly AgentActivityEntry[],
  cost: AgentCostState = COST,
): void {
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <AgentActivitySection cost={cost} entries={entries} />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

it("shows the monthly spending and the empty state without entries", () => {
  renderSection([]);
  expect(screen.getByText(/^Diesen Monat: 1,50\s\$$/u)).toBeDefined();
  expect(
    screen.getByText(i18n.t("agentEmployees.activity.empty")),
  ).toBeDefined();
  expect(screen.queryByRole("list")).toBeNull();
  expect(screen.queryByText(/ohne gemeldete Kosten/u)).toBeNull();
});

it("names the sessions without a reported cost", () => {
  renderSection([], { ...COST, unknownSessions: 2 });
  expect(
    screen.getByText(
      i18n.t("agentEmployees.activity.unknownSessions", { count: 2 }),
    ),
  ).toBeDefined();
});

it("describes a session with person and state", () => {
  renderSection([
    activityEntry({
      kind: "session",
      detail: JSON.stringify({ person: "Grace", state: "completed" }),
    }),
  ]);
  expect(screen.getByText("Sitzung mit Grace · beendet")).toBeDefined();
});

it("falls back to the neutral state when the detail has none", () => {
  renderSection([activityEntry({ kind: "session", detail: "{}" })]);
  expect(screen.getByText(/^Sitzung mit\s+·\s+–$/u)).toBeDefined();
});

it("reads a detail that is no JSON object as empty", () => {
  renderSection([
    activityEntry({ id: "a", kind: "ticket", detail: "not json" }),
    activityEntry({ id: "b", kind: "wiki", detail: "42" }),
    activityEntry({ id: "c", kind: "wiki", detail: "null" }),
  ]);
  expect(screen.getByText("Ticket:")).toBeDefined();
  expect(screen.getAllByText("Wiki:")).toHaveLength(2);
});

it("describes ticket and wiki entries with their message", () => {
  renderSection([
    activityEntry({
      id: "a",
      kind: "ticket",
      detail: JSON.stringify({ message: "PAGE-1 Fix" }),
    }),
    activityEntry({
      id: "b",
      kind: "wiki",
      detail: JSON.stringify({ message: 7 }),
    }),
  ]);
  expect(screen.getByText("Ticket: PAGE-1 Fix")).toBeDefined();
  expect(screen.getByText("Wiki: 7")).toBeDefined();
});

it("describes a learning run with its counters and a model run as a session", () => {
  renderSection([
    activityEntry({
      id: "a",
      kind: "learning",
      detail: JSON.stringify({
        status: "updated",
        added: 3,
        merged: 2,
        archived: 1,
        removed: 4,
      }),
    }),
    activityEntry({
      id: "b",
      kind: "learning",
      detail: JSON.stringify({ isModelRun: true, state: "running" }),
    }),
    activityEntry({ id: "c", kind: "learning", detail: "{}" }),
  ]);
  expect(
    screen.getByText(
      "Traumlauf: 3 neue Lehren, 2 zusammengeführt, 4 herausgefallen",
    ),
  ).toBeDefined();
  expect(screen.getByText("Gedächtnis-Sitzung · läuft")).toBeDefined();
  expect(
    screen.getByText("Traumlauf: nichts Neues, kein Modell gestartet"),
  ).toBeDefined();
});

it("links an entry that has an address and leaves the others as text", () => {
  renderSection([
    activityEntry({
      id: "a",
      kind: "ticket",
      detail: JSON.stringify({ message: "Linked" }),
      link: "/tickets/PAGE-1",
    }),
    activityEntry({
      id: "b",
      kind: "ticket",
      detail: JSON.stringify({ message: "Plain" }),
    }),
  ]);
  expect(
    screen.getByRole("link", { name: "Ticket: Linked" }).getAttribute("href"),
  ).toBe("/tickets/PAGE-1");
  expect(screen.queryByRole("link", { name: "Ticket: Plain" })).toBeNull();
  expect(screen.getByText("Ticket: Plain")).toBeDefined();
});

it("shows known, estimated and unknown costs and none for free entries", () => {
  renderSection([
    activityEntry({
      id: "a",
      cost: { state: "known", amount: 0.25, isEstimated: false },
    }),
    activityEntry({
      id: "b",
      cost: { state: "known", amount: 0.5, isEstimated: true },
    }),
    activityEntry({
      id: "c",
      cost: { state: "unknown", amount: null, isEstimated: false },
    }),
    activityEntry({
      id: "d",
      cost: { state: "known", amount: null, isEstimated: false },
    }),
    activityEntry({ id: "e" }),
  ]);
  const money = new Intl.NumberFormat("de", {
    style: "currency",
    currency: "USD",
  });
  const rows = within(screen.getByRole("list")).getAllByRole("listitem");
  expect(rows).toHaveLength(5);
  expect(rows[0]?.textContent).toContain(money.format(0.25));
  expect(rows[1]?.textContent).toContain(`${money.format(0.5)} (geschätzt)`);
  expect(rows[2]?.textContent).toContain("Kosten unbekannt");
  expect(rows[3]?.textContent).not.toContain("$");
  expect(rows[4]?.textContent).not.toContain("$");
});
