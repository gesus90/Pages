// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();

  return {
    ...actual,
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
    useLoaderData: vi.fn(),
  };
});

import { I18nextProvider } from "react-i18next";
import { useLoaderData } from "react-router";

import { createI18n } from "@/app/lib/i18n";
import { LANGUAGE } from "@/language/Language";
import DashboardRoute from "@/app/routes/dashboard";

import type { DashboardLoaderData } from "@/app/routes/dashboard";

const mockedLoaderData = vi.mocked(useLoaderData);

function createLoaderData(
  overrides: Partial<DashboardLoaderData> = {},
): DashboardLoaderData {
  return {
    displayName: "Admin",
    hour: 9,
    inProgressTickets: 5,
    myTasks: [],
    newProjects: 1,
    openDelta: 2,
    openTickets: 12,
    overdueDelta: 1,
    overdueTickets: 3,
    projectCount: 4,
    projectOverview: [],
    recentlyEdited: [],
    upcomingDeadlines: [],
    ...overrides,
  };
}

function renderDashboard(hour: number, displayName = "Admin"): void {
  mockedLoaderData.mockReturnValue(createLoaderData({ displayName, hour }));
  const i18n = createI18n(LANGUAGE.GERMAN);

  render(
    <I18nextProvider i18n={i18n}>
      <DashboardRoute />
    </I18nextProvider>,
  );
}

describe("DashboardRoute", () => {
  it("greets morning visitors before noon", () => {
    renderDashboard(0);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Guten Morgen, Admin.",
    );
  });

  it("greets late-morning visitors before noon", () => {
    renderDashboard(11);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Guten Morgen, Admin.",
    );
  });

  it("greets midday visitors in the afternoon wording", () => {
    renderDashboard(12);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Guten Tag, Admin.",
    );
  });

  it("greets late-afternoon visitors", () => {
    renderDashboard(17);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Guten Tag, Admin.",
    );
  });

  it("greets evening visitors", () => {
    renderDashboard(18);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Guten Abend, Admin.",
    );
  });

  it("greets night visitors in the evening wording", () => {
    renderDashboard(23);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Guten Abend, Admin.",
    );
  });

  it("personalizes the greeting with the display name", () => {
    renderDashboard(9, "Müller 🚀");

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Müller 🚀",
    );
  });

  it("renders the KPI cards and dashboard panels", () => {
    renderDashboard(9);

    expect(screen.getByText("Offene Tickets")).toBeInTheDocument();
    expect(screen.getByText("Meine Aufgaben")).toBeInTheDocument();
    expect(screen.getByText("Projektübersicht")).toBeInTheDocument();
    expect(screen.getByText("Zuletzt bearbeitet")).toBeInTheDocument();
    expect(screen.getByText("Anstehende Deadlines")).toBeInTheDocument();
  });
});
