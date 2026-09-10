// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nextProvider } from "react-i18next";

import { TaskActivityList } from "@/app/components/tasks/task-activity-list";
import { createI18n } from "@/app/lib/i18n";
import { LANGUAGE } from "@/language/Language";

describe("TaskActivityList", () => {
  it("renders an empty state without history", () => {
    const i18n = createI18n(LANGUAGE.GERMAN);

    render(
      <I18nextProvider i18n={i18n}>
        <TaskActivityList history={[]} />
      </I18nextProvider>,
    );

    expect(screen.getByText("Keine")).toBeInTheDocument();
  });

  it("renders history entries with user and timestamp", () => {
    const i18n = createI18n(LANGUAGE.GERMAN);

    render(
      <I18nextProvider i18n={i18n}>
        <TaskActivityList
          history={[
            {
              action: "label_added",
              createdAt: "2026-09-05 14:37",
              field: "label",
              id: "hist-1",
              newValue: "Feature",
              oldValue: null,
              userDisplayName: "Admin",
              userId: "user-1",
              workItemId: "item-1",
            },
          ]}
        />
      </I18nextProvider>,
    );

    expect(
      screen.getByText("Admin fügte das Label Feature hinzu."),
    ).toBeInTheDocument();
    expect(screen.getByText("2026-09-05 14:37")).toBeInTheDocument();
  });

  it("falls back to placeholders when a record has no detail fields", () => {
    const i18n = createI18n(LANGUAGE.GERMAN);

    render(
      <I18nextProvider i18n={i18n}>
        <TaskActivityList
          history={[
            {
              action: "label_added",
              createdAt: "2026-09-05 14:37",
              field: null,
              id: "hist-1",
              newValue: null,
              oldValue: null,
              userDisplayName: null,
              userId: "user-1",
              workItemId: "item-1",
            },
          ]}
        />
      </I18nextProvider>,
    );

    expect(screen.getByText("2026-09-05 14:37")).toBeInTheDocument();
  });
});
