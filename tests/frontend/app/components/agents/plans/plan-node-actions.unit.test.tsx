import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import {
  PlanNodeActions,
  PlanNodeEditButton,
} from "@/app/components/agents/plans/plan-node-actions";

import { i18n, renderTranslated } from "./plan-flow-fixture";

const MENU = i18n.t("settings.agents.actionsFor", { name: "Reviewer" });

async function openMenu(): Promise<HTMLElement> {
  fireEvent.keyDown(screen.getByRole("button", { name: MENU }), {
    key: "Enter",
  });
  return screen.findByRole("menu");
}

it("deletes the node from its menu and gives the focus back to the trigger", async () => {
  const onRemove = vi.fn();
  renderTranslated(
    <PlanNodeActions label="Reviewer" disabled={false} onRemove={onRemove} />,
  );
  await openMenu();
  expect(
    screen.queryByRole("menuitem", {
      name: i18n.t("plans.templates.saveAction"),
    }),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("menuitem", { name: i18n.t("plans.delete") }),
  );
  expect(onRemove).toHaveBeenCalledOnce();
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: MENU }),
  );
});

it("moves the focus to the canvas when a checkpoint is deleted", async () => {
  const onRemove = vi.fn();
  renderTranslated(
    <section aria-label="Canvas" tabIndex={-1}>
      <div className="react-flow">
        <PlanNodeActions
          label="Reviewer"
          disabled={false}
          onRemove={onRemove}
          shouldFocusCanvasOnRemove
          size="large"
        />
      </div>
    </section>,
  );
  await openMenu();
  fireEvent.click(
    screen.getByRole("menuitem", { name: i18n.t("plans.delete") }),
  );
  expect(onRemove).toHaveBeenCalledOnce();
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("region", { name: "Canvas" }),
    ),
  );
});

it("keeps the focus at the trigger when a checkpoint outside a canvas is deleted", async () => {
  renderTranslated(
    <PlanNodeActions
      label="Reviewer"
      disabled={false}
      onRemove={vi.fn()}
      shouldFocusCanvasOnRemove
    />,
  );
  await openMenu();
  fireEvent.click(
    screen.getByRole("menuitem", { name: i18n.t("plans.delete") }),
  );
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: MENU }),
    ),
  );
});

it("saves a template without pulling the focus back to the trigger", async () => {
  const onSaveTemplate = vi.fn();
  renderTranslated(
    <PlanNodeActions
      label="Reviewer"
      disabled={false}
      onRemove={vi.fn()}
      onSaveTemplate={onSaveTemplate}
    />,
  );
  await openMenu();
  fireEvent.click(
    screen.getByRole("menuitem", {
      name: i18n.t("plans.templates.saveAction"),
    }),
  );
  expect(onSaveTemplate).toHaveBeenCalledOnce();
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  // The save dialog takes the focus; the trigger leaves it alone.
  expect(document.activeElement).not.toBe(
    screen.getByRole("button", { name: MENU }),
  );
  // The next closing of the menu restores the focus as usual.
  await openMenu();
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: MENU }),
    ),
  );
});

it("locks the menu without edit rights", () => {
  renderTranslated(
    <PlanNodeActions label="Reviewer" disabled onRemove={vi.fn()} />,
  );
  expect(screen.getByRole("button", { name: MENU })).toHaveProperty(
    "disabled",
    true,
  );
});

it("keeps menu events away from the canvas", async () => {
  const onCanvas = vi.fn();
  renderTranslated(
    // The canvas selects, drags and deletes on these events.
    <div
      role="presentation"
      onPointerDown={onCanvas}
      onClick={onCanvas}
      onDoubleClick={onCanvas}
      onKeyDown={onCanvas}
    >
      <PlanNodeActions label="Reviewer" disabled={false} onRemove={vi.fn()} />
      <PlanNodeEditButton label="Reviewer" onEdit={vi.fn()} />
    </div>,
  );
  const edit = screen.getByRole("button", {
    name: i18n.t("plans.editNamed", { name: "Reviewer" }),
  });
  fireEvent.pointerDown(edit);
  fireEvent.doubleClick(edit);
  fireEvent.click(edit);
  const trigger = screen.getByRole("button", { name: MENU });
  fireEvent.click(trigger);
  fireEvent.doubleClick(trigger);
  fireEvent.pointerDown(trigger);
  const menu = await screen.findByRole("menu");
  onCanvas.mockClear();
  fireEvent.click(menu);
  fireEvent.doubleClick(menu);
  fireEvent.keyDown(menu, { key: "Delete" });
  expect(onCanvas).not.toHaveBeenCalled();
});

it("opens the node dialog from the edit button", () => {
  const onEdit = vi.fn();
  renderTranslated(<PlanNodeEditButton label="Reviewer" onEdit={onEdit} />);
  const edit = screen.getByRole("button", {
    name: i18n.t("plans.editNamed", { name: "Reviewer" }),
  });
  expect(edit.getAttribute("title")).toBe(
    i18n.t("plans.editNamed", { name: "Reviewer" }),
  );
  fireEvent.click(edit);
  expect(onEdit).toHaveBeenCalledOnce();
});
