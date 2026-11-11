import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import { WikiAnchorsDialog } from "@/app/components/wiki/wiki-anchors-dialog";
import { createI18n } from "@/app/lib/i18n";

import type { WikiPage } from "@/definition/Wiki";

vi.mock("react-router", () => ({
  useFetcher: () => ({ state: "idle", Form: "form" }),
}));

const page: WikiPage = {
  id: "page",
  title: "Page",
  icon: null,
  scope: "instance",
  projectId: null,
  projectName: null,
  parentId: null,
  ownerId: "u",
  ownerName: "User",
  currentUntil: null,
  updatedAt: "2026-01-01",
  createdAt: "2026-01-01",
  content: "",
  cover: null,
  revision: 1,
  isTemplate: false,
  updatedByName: null,
  breadcrumb: [],
  anchors: [{ kind: "epic", targetId: "deleted", label: null }],
};

it("shows selected anchors, missing targets, and submitted choices", () => {
  const i18n = createI18n("en");
  render(
    <I18nextProvider i18n={i18n}>
      <WikiAnchorsDialog
        page={page}
        choices={{
          departments: [{ id: "d", name: "Design" }],
          milestones: [{ id: "m", name: "Launch", projectName: "Project" }],
          epics: [{ id: "e", key: "P-1", title: "Work" }],
          selected: [{ kind: "department", targetId: "d" }],
        }}
        onClose={vi.fn()}
      />
    </I18nextProvider>,
  );
  const department = screen.getByRole("checkbox", { name: "Design" });
  const milestone = screen.getByRole("checkbox", { name: "Project / Launch" });
  expect(department).toHaveProperty("checked", true);
  expect(milestone).toHaveProperty("checked", false);
  expect(screen.getByRole("status").textContent).toBe(
    i18n.t("wiki.dialog.anchors.missing", { count: 1 }),
  );
  fireEvent.click(milestone);
  const form = milestone.closest("form");
  expect(form).not.toBeNull();
  if (!form) throw new Error("Missing form");
  expect(new FormData(form).getAll("anchor")).toEqual([
    "department:d",
    "milestone:m",
  ]);
  expect(new FormData(form).get("intent")).toBe("set-anchors");
  expect(form.getAttribute("action")).toBe("/wiki/page");
});
