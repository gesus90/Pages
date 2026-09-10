// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nextProvider } from "react-i18next";

import { createI18n } from "@/app/lib/i18n";
import { LANGUAGE } from "@/language/Language";
import { DashboardRecentlyEdited } from "@/app/components/dashboard/dashboard-recently-edited";

import type { Language } from "@/language/Language";
import type { DashboardRecentItem } from "@/app/components/dashboard/dashboard-recently-edited";

function renderItems(
  items: readonly DashboardRecentItem[],
  language: Language = LANGUAGE.GERMAN,
): void {
  const i18n = createI18n(language);

  render(
    <I18nextProvider i18n={i18n}>
      <DashboardRecentlyEdited items={items} />
    </I18nextProvider>,
  );
}

function createItem(
  overrides: Partial<DashboardRecentItem> = {},
): DashboardRecentItem {
  return {
    id: "item-1",
    projectName: "Pages",
    title: "Release notes",
    updatedAt: "2026-03-15T10:00:00.000Z",
    ...overrides,
  };
}

describe("DashboardRecentlyEdited", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T11:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders an empty-state message when no items are present", () => {
    renderItems([]);

    expect(screen.getByText("Noch nichts bearbeitet.")).toBeInTheDocument();
  });

  it("renders the column headers and every provided item", () => {
    renderItems([
      createItem({ id: "item-1", title: "Release notes" }),
      createItem({ id: "item-2", projectName: "Atlas", title: "Roadmap" }),
    ]);

    expect(screen.getByText("Titel")).toBeInTheDocument();
    expect(screen.getByText("Projekt")).toBeInTheDocument();
    expect(screen.getByText("Bearbeitet")).toBeInTheDocument();
    expect(screen.getByText("Release notes")).toBeInTheDocument();
    expect(screen.getByText("Roadmap")).toBeInTheDocument();
    expect(screen.getByText("Atlas")).toBeInTheDocument();
  });

  it("formats recent edits using the minute unit in german", () => {
    renderItems([createItem({ updatedAt: "2026-03-15T10:30:00.000Z" })]);

    expect(screen.getAllByText("vor 30 Minuten").length).toBeGreaterThan(0);
  });

  it("formats recent edits using the minute unit in english", () => {
    renderItems(
      [createItem({ updatedAt: "2026-03-15T10:30:00.000Z" })],
      LANGUAGE.ENGLISH,
    );

    expect(screen.getAllByText("30 minutes ago").length).toBeGreaterThan(0);
  });

  it("formats older edits using the hour unit", () => {
    renderItems([createItem({ updatedAt: "2026-03-15T08:00:00.000Z" })]);

    expect(screen.getAllByText("vor 3 Stunden").length).toBeGreaterThan(0);
  });

  it("formats much older edits using the day unit", () => {
    renderItems([createItem({ updatedAt: "2026-03-13T11:00:00.000Z" })]);

    expect(screen.getAllByText("vorgestern").length).toBeGreaterThan(0);
  });

  it("falls back to an empty subtitle when the date is unparseable", () => {
    renderItems([createItem({ id: "broken", updatedAt: "not-a-date" })]);

    const row = screen.getByText("Release notes").closest("li");

    expect(row).not.toBeNull();

    if (row) {
      const subtitle = row.querySelector("p:nth-of-type(2)");

      expect(subtitle?.textContent ?? "").toBe("");
    }
  });

  it("falls back to an empty relative label when the date is unparseable", () => {
    renderItems([createItem({ id: "broken", updatedAt: "not-a-date" })]);

    const row = screen.getByText("Release notes").closest("li");

    expect(row).not.toBeNull();

    if (row) {
      const editedColumn = row.querySelectorAll("span")[2];

      expect(editedColumn?.textContent ?? "").toBe("");
    }
  });
});
