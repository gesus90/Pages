// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";

import {
  TaskLabelList,
  TaskLabelPill,
} from "@/app/components/tasks/task-labels";
import { createI18n } from "@/app/lib/i18n";
import { LANGUAGE } from "@/language/Language";

import type { ProjectLabel } from "@/definition/Task";

function createLabel(overrides: Partial<ProjectLabel> = {}): ProjectLabel {
  return {
    color: "#3b82f6",
    createdAt: "2026-01-01",
    id: "label-1",
    name: "Feature",
    projectId: "project-1",
    updatedAt: "2026-01-02",
    ...overrides,
  };
}

function renderWithProviders(children: React.ReactElement): void {
  const i18n = createI18n(LANGUAGE.GERMAN);

  render(<I18nextProvider i18n={i18n}>{children}</I18nextProvider>);
}

describe("TaskLabelPill", () => {
  it("renders the label name with its color", () => {
    renderWithProviders(<TaskLabelPill label={createLabel()} />);

    expect(screen.getByText("Feature")).toBeInTheDocument();
  });

  it("removes labels through the pill action", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    renderWithProviders(
      <TaskLabelPill label={createLabel()} onRemove={onRemove} />,
    );

    await user.click(screen.getByRole("button", { name: "Feature ×" }));

    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});

describe("TaskLabelList", () => {
  it("renders nothing without labels", () => {
    const { container } = render(<TaskLabelList labels={[]} />);

    expect(container.firstChild).toBeNull();
  });

  it("renders pills and collapses overflow", () => {
    renderWithProviders(
      <TaskLabelList
        labels={[
          createLabel(),
          createLabel({ id: "label-2", name: "Bug" }),
          createLabel({ id: "label-3", name: "Frontend" }),
        ]}
        maxVisible={2}
      />,
    );

    expect(screen.getByText("Feature")).toBeInTheDocument();
    expect(screen.getByText("Bug")).toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
  });
});
