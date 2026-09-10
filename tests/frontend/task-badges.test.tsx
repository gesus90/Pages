// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nextProvider } from "react-i18next";

import {
  TaskPriorityBadge,
  TaskStatusBadge,
  TaskTypeBadge,
} from "@/app/components/tasks/task-badges";
import { createI18n } from "@/app/lib/i18n";
import {
  WORK_ITEM_PRIORITY,
  WORK_ITEM_TYPE,
  WORKFLOW_STATUS_KEY,
} from "@/definition/Task";
import { LANGUAGE } from "@/language/Language";

function renderWithI18n(ui: React.ReactElement): void {
  const i18n = createI18n(LANGUAGE.GERMAN);
  render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

describe("TaskTypeBadge", () => {
  it("renders an Epic badge", () => {
    renderWithI18n(<TaskTypeBadge type={WORK_ITEM_TYPE.EPIC} />);
    expect(screen.getByText("Epic")).toBeInTheDocument();
  });

  it("renders a Subtask badge", () => {
    renderWithI18n(<TaskTypeBadge type={WORK_ITEM_TYPE.SUBTASK} />);
    expect(screen.getByText("Subtask")).toBeInTheDocument();
  });

  it("renders a Task badge", () => {
    renderWithI18n(<TaskTypeBadge type={WORK_ITEM_TYPE.TASK} />);
    expect(screen.getByText("Task")).toBeInTheDocument();
  });
});

describe("TaskPriorityBadge", () => {
  it("renders urgent priority", () => {
    renderWithI18n(<TaskPriorityBadge priority={WORK_ITEM_PRIORITY.URGENT} />);
    expect(screen.getByText("Dringend")).toBeInTheDocument();
  });

  it("renders high priority", () => {
    renderWithI18n(<TaskPriorityBadge priority={WORK_ITEM_PRIORITY.HIGH} />);
    expect(screen.getByText("Hoch")).toBeInTheDocument();
  });

  it("renders low priority", () => {
    renderWithI18n(<TaskPriorityBadge priority={WORK_ITEM_PRIORITY.LOW} />);
    expect(screen.getByText("Niedrig")).toBeInTheDocument();
  });

  it("renders normal priority", () => {
    renderWithI18n(<TaskPriorityBadge priority={WORK_ITEM_PRIORITY.NORMAL} />);
    expect(screen.getByText("Normal")).toBeInTheDocument();
  });
});

describe("TaskStatusBadge", () => {
  it.each([
    [WORKFLOW_STATUS_KEY.BACKLOG, "Backlog"],
    [WORKFLOW_STATUS_KEY.TODO, "To Do"],
    [WORKFLOW_STATUS_KEY.IN_PROGRESS, "In Arbeit"],
    [WORKFLOW_STATUS_KEY.REVIEW, "Review"],
    [WORKFLOW_STATUS_KEY.DONE, "Done"],
  ])("renders status dot for %s", (key, name) => {
    renderWithI18n(<TaskStatusBadge statusKey={key} statusName={name} />);
    expect(screen.getByText(name)).toBeInTheDocument();
  });
});
