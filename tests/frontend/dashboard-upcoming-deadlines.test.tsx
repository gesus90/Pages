// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { I18nextProvider } from "react-i18next";

import { createI18n } from "@/app/lib/i18n";
import { LANGUAGE } from "@/language/Language";
import { DashboardUpcomingDeadlines } from "@/app/components/dashboard/dashboard-upcoming-deadlines";

import type { Language } from "@/language/Language";
import type { DashboardDeadline } from "@/app/components/dashboard/dashboard-upcoming-deadlines";

function renderDeadlines(
  deadlines: readonly DashboardDeadline[],
  language: Language = LANGUAGE.GERMAN,
): void {
  const i18n = createI18n(language);

  render(
    <I18nextProvider i18n={i18n}>
      <DashboardUpcomingDeadlines deadlines={deadlines} />
    </I18nextProvider>,
  );
}

function createDeadline(
  overrides: Partial<DashboardDeadline> = {},
): DashboardDeadline {
  return {
    daysLeft: 3,
    dueAt: "2026-03-18T10:00:00.000Z",
    id: "deadline-1",
    projectName: "Pages",
    title: "Release 1.0",
    ...overrides,
  };
}

describe("DashboardUpcomingDeadlines", () => {
  it("renders an empty-state message when no deadlines are present", () => {
    renderDeadlines([]);

    expect(
      screen.getByText("Keine anstehenden Deadlines."),
    ).toBeInTheDocument();
  });

  it("renders the column headers and every provided deadline", () => {
    renderDeadlines([
      createDeadline({ id: "deadline-1", title: "Release 1.0" }),
      createDeadline({
        daysLeft: 7,
        dueAt: "2026-03-22T10:00:00.000Z",
        id: "deadline-2",
        projectName: "Atlas",
        title: "Roadmap sync",
      }),
    ]);

    expect(screen.getByText("Datum")).toBeInTheDocument();
    expect(screen.getByText("Aufgabe")).toBeInTheDocument();
    expect(screen.getByText("Projekt")).toBeInTheDocument();
    expect(screen.getByText("In")).toBeInTheDocument();
    expect(screen.getByText("Release 1.0")).toBeInTheDocument();
    expect(screen.getByText("Roadmap sync")).toBeInTheDocument();
    expect(screen.getByText("Atlas")).toBeInTheDocument();
    expect(screen.getByText("in 3 Tagen")).toBeInTheDocument();
    expect(screen.getByText("in 7 Tagen")).toBeInTheDocument();
  });

  it("shows the today label when daysLeft is zero", () => {
    renderDeadlines([createDeadline({ daysLeft: 0 })]);

    expect(screen.getByText("Heute")).toBeInTheDocument();
  });

  it("shows the today label when daysLeft is negative", () => {
    renderDeadlines([createDeadline({ daysLeft: -2 })]);

    expect(screen.getByText("Heute")).toBeInTheDocument();
  });

  it("renders the day badge in the german locale", () => {
    renderDeadlines([createDeadline({ dueAt: "2026-03-18T10:00:00.000Z" })]);

    expect(screen.getByText("18")).toBeInTheDocument();
    expect(screen.getByText("MÄR")).toBeInTheDocument();
  });

  it("renders the day badge in the english locale", () => {
    renderDeadlines(
      [createDeadline({ dueAt: "2026-03-18T10:00:00.000Z" })],
      LANGUAGE.ENGLISH,
    );

    expect(screen.getByText("18")).toBeInTheDocument();
    expect(screen.getByText("MAR")).toBeInTheDocument();
  });
});
