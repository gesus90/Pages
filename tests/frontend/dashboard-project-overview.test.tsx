// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { I18nextProvider } from "react-i18next";

import { createI18n } from "@/app/lib/i18n";
import { LANGUAGE } from "@/language/Language";
import { DashboardProjectOverview } from "@/app/components/dashboard/dashboard-project-overview";

import type { DashboardProjectEntry } from "@/app/components/dashboard/dashboard-project-overview";

function renderOverview(projects: readonly DashboardProjectEntry[]): void {
  const i18n = createI18n(LANGUAGE.GERMAN);

  render(
    <I18nextProvider i18n={i18n}>
      <DashboardProjectOverview projects={projects} />
    </I18nextProvider>,
  );
}

function createProject(
  overrides: Partial<DashboardProjectEntry> = {},
): DashboardProjectEntry {
  return {
    done: 3,
    id: "project-1",
    name: "Pages",
    percentage: 60,
    total: 5,
    ...overrides,
  };
}

describe("DashboardProjectOverview", () => {
  it("renders an empty-state message when no projects are present", () => {
    renderOverview([]);

    expect(screen.getByText("Keine Projekte vorhanden.")).toBeInTheDocument();
  });

  it("renders the column headers and every provided project", () => {
    renderOverview([
      createProject({ id: "project-1", name: "Pages" }),
      createProject({
        done: 1,
        id: "project-2",
        name: "Atlas",
        percentage: 20,
        total: 5,
      }),
    ]);

    expect(screen.getByText("Projekt")).toBeInTheDocument();
    expect(screen.getByText("Fortschritt")).toBeInTheDocument();
    expect(screen.getByText("Pages")).toBeInTheDocument();
    expect(screen.getByText("Atlas")).toBeInTheDocument();
    expect(screen.getByText("3 von 5 Aufgaben")).toBeInTheDocument();
    expect(screen.getByText("1 von 5 Aufgaben")).toBeInTheDocument();
  });

  it("exposes the percentage and accessible progress bar metadata", () => {
    renderOverview([createProject({ percentage: 75 })]);

    expect(screen.getByText("75%")).toBeInTheDocument();

    const bar = screen.getByRole("progressbar", { name: "Pages" });

    expect(bar).toHaveAttribute("aria-valuenow", "75");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");

    const fill = bar.firstElementChild;

    expect(fill).not.toBeNull();

    if (fill) {
      expect(fill).toHaveStyle({ width: "75%" });
    }
  });
});
