// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { I18nextProvider } from "react-i18next";

import { createI18n } from "@/app/lib/i18n";
import { LANGUAGE } from "@/language/Language";
import { DashboardMyTasks } from "@/app/components/dashboard/dashboard-my-tasks";

import type { Language } from "@/language/Language";
import type { DashboardMyTask } from "@/app/components/dashboard/dashboard-my-tasks";

function renderTasks(
  tasks: readonly DashboardMyTask[],
  language: Language = LANGUAGE.GERMAN,
): void {
  const i18n = createI18n(language);

  render(
    <I18nextProvider i18n={i18n}>
      <DashboardMyTasks tasks={tasks} />
    </I18nextProvider>,
  );
}

function createTask(overrides: Partial<DashboardMyTask> = {}): DashboardMyTask {
  return {
    dueAt: "2026-03-15T10:00:00.000Z",
    id: "task-1",
    isDueToday: false,
    isOverdue: false,
    projectName: "Pages",
    title: "Write release notes",
    ...overrides,
  };
}

describe("DashboardMyTasks", () => {
  it("renders an empty-state message when no tasks are present", () => {
    renderTasks([]);

    expect(screen.getByText("Keine Aufgaben vorhanden.")).toBeInTheDocument();
  });

  it("renders the column headers and every provided task", () => {
    renderTasks([
      createTask({ id: "task-1", title: "Write release notes" }),
      createTask({
        id: "task-2",
        projectName: "Atlas",
        title: "Review pull request",
      }),
    ]);

    expect(screen.getByText("Aufgabe")).toBeInTheDocument();
    expect(screen.getByText("Projekt")).toBeInTheDocument();
    expect(screen.getByText("Fällig am")).toBeInTheDocument();
    expect(screen.getByText("Write release notes")).toBeInTheDocument();
    expect(screen.getByText("Pages")).toBeInTheDocument();
    expect(screen.getByText("Review pull request")).toBeInTheDocument();
    expect(screen.getByText("Atlas")).toBeInTheDocument();
  });

  it("formats due dates in the german locale for non-today tasks", () => {
    renderTasks([createTask({ dueAt: "2026-03-15T10:00:00.000Z" })]);

    expect(screen.getByText("15. März 2026")).toBeInTheDocument();
  });

  it("formats due dates in the english locale when language is en", () => {
    renderTasks(
      [createTask({ dueAt: "2026-03-15T10:00:00.000Z" })],
      LANGUAGE.ENGLISH,
    );

    expect(screen.getByText("15 Mar 2026")).toBeInTheDocument();
  });

  it("shows the today label for tasks due today", () => {
    renderTasks([createTask({ isDueToday: true })]);

    expect(screen.getByText("Heute")).toBeInTheDocument();
  });

  it("shows the no-due-date label when the task has no due date", () => {
    renderTasks([createTask({ dueAt: null })]);

    expect(screen.getByText("Keine Frist")).toBeInTheDocument();
  });

  it("renders the overdue badge for overdue tasks", () => {
    renderTasks([createTask({ isOverdue: true, title: "Late task" })]);

    expect(screen.getByText("Überfällig")).toBeInTheDocument();
    expect(screen.getByText("Late task")).toBeInTheDocument();
  });

  it("does not render the overdue badge for non-overdue tasks", () => {
    renderTasks([createTask({ isOverdue: false })]);

    expect(screen.queryByText("Überfällig")).not.toBeInTheDocument();
  });
});
