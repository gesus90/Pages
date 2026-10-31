import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import { KanbanTicketCard } from "@/app/components/tasks/kanban/kanban-ticket-card";
import { createI18n } from "@/app/lib/i18n";

import { workItem } from "../../lib/work-item-fixture";

it("opens by double click and keyboard, but not after a drag", () => {
  const open = vi.fn();
  const select = vi.fn();
  const startDrag = vi.fn();
  render(
    <I18nextProvider i18n={createI18n("en")}>
      <KanbanTicketCard
        item={workItem("one")}
        labels={[]}
        isSelected={false}
        isBeingDragged={false}
        statuses={[]}
        onChangeStatus={vi.fn()}
        onSelectTask={select}
        onOpenTask={open}
        onDragStart={startDrag}
        onDragEnd={vi.fn()}
      />
    </I18nextProvider>,
  );
  const card = screen.getByRole("button");
  fireEvent.click(card);
  expect(select).toHaveBeenCalledOnce();
  expect(open).not.toHaveBeenCalled();
  fireEvent.doubleClick(card);
  expect(open).toHaveBeenCalledOnce();
  fireEvent.keyDown(card, { key: "Enter" });
  expect(open).toHaveBeenCalledTimes(2);
  fireEvent.dragStart(card);
  fireEvent.dragEnd(card);
  fireEvent.doubleClick(card);
  expect(open).toHaveBeenCalledTimes(2);
  expect(startDrag).toHaveBeenCalledOnce();
  fireEvent.pointerDown(card);
  fireEvent.doubleClick(card);
  expect(open).toHaveBeenCalledTimes(3);
});
