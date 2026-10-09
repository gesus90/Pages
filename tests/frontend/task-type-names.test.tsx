// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";

import { workItemTypeOptions } from "@/app/components/tasks/form/task-form-options";
import { TaskTypeBadge } from "@/app/components/tasks/task-badges";
import { createI18n } from "@/app/lib/i18n";
import { WORK_ITEM_CHILD_TYPE, WORK_ITEM_TYPE } from "@/definition/Task";

const NAMES = [
  [WORK_ITEM_TYPE.INITIATIVE, "Initiative", "Initiatives"],
  [WORK_ITEM_TYPE.EPIC, "Epic", "Epics"],
  [WORK_ITEM_TYPE.TASK, "Task", "Tasks"],
  [WORK_ITEM_TYPE.SUBTASK, "Subtask", "Subtasks"],
] as const;

it("preserves the four stored types and their existing hierarchy", () => {
  expect(Object.values(WORK_ITEM_TYPE)).toEqual([
    "initiative",
    "epic",
    "task",
    "subtask",
  ]);
  expect(WORK_ITEM_CHILD_TYPE).toEqual({
    initiative: "epic",
    epic: "task",
    task: "subtask",
    subtask: null,
  });
});

describe.each(["de", "en"] as const)("fixed type names in %s", (language) => {
  it.each(NAMES)(
    "uses exact singular/plural names for %s in badges, forms, filters and counts",
    (type, singular, plural) => {
      const i18n = createI18n(language);
      const translate = i18n.t.bind(i18n);
      expect(i18n.t(`tasks.type.${type}`)).toBe(singular);
      expect(i18n.t(`tasks.typePlural.${type}`)).toBe(plural);
      expect(i18n.t(`tasks.filter.typeOption.${type}`)).toBe(singular);
      expect(i18n.t(`tasks.count.${type}`, { count: 1 })).toBe(`1 ${singular}`);
      expect(i18n.t(`tasks.count.${type}`, { count: 2 })).toBe(`2 ${plural}`);
      expect(
        workItemTypeOptions(translate).find((option) => option.value === type)
          ?.label,
      ).toBe(singular);
      render(
        <I18nextProvider i18n={i18n}>
          <TaskTypeBadge type={type} />
        </I18nextProvider>,
      );
      expect(screen.getByText(singular)).toBeVisible();
    },
  );

  it("uses the same type tokens in hierarchy actions, details and validation errors", () => {
    const i18n = createI18n(language);
    const translate = i18n.t.bind(i18n);
    expect(translate("tasks.children.add.initiative")).toContain("Epic");
    expect(translate("tasks.children.add.epic")).toContain("Task");
    expect(translate("tasks.children.add.task")).toContain("Subtask");
    expect(translate("tasks.tabs.subtasks")).toBe("Subtasks");
    expect(translate("tasks.detail.containedEpics")).toContain("Epics");
    expect(translate("tasks.detail.containedTasks")).toContain("Tasks");
    for (const [key, names] of [
      ["epicParentType", ["Epic", "Initiative"]],
      ["taskParentType", ["Task", "Epic"]],
      ["subtaskParentType", ["Subtask", "Task"]],
    ] as const) {
      for (const name of names)
        expect(translate(`tasks.error.${key}`)).toContain(name);
    }
    const combined = [
      translate("tasks.tree.group.no-initiative"),
      translate("tasks.tree.group.no-epic"),
      translate("tasks.fields.parentTask"),
    ].join(" ");
    expect(combined).not.toMatch(
      /Vorhaben|Arbeitspaket|Unteraufgabe|Aufgabe|work package/,
    );
  });
});
