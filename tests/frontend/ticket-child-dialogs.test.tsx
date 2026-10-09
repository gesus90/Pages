// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { useTasksDialog } from "@/app/components/tasks/board/use-tasks-dialog";
import { useTicketDialogs } from "@/app/components/tasks/ticket/use-ticket-dialogs";
import { WORK_ITEM_TYPE } from "@/definition/Task";

import { createWorkItem } from "../helpers/factories";

import type { WorkItemType } from "@/definition/Task";

function wrapper({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  const router = createMemoryRouter([{ element: children, path: "/" }]);

  return <RouterProvider router={router} />;
}

const LEVELS: readonly [WorkItemType, WorkItemType][] = [
  [WORK_ITEM_TYPE.INITIATIVE, WORK_ITEM_TYPE.EPIC],
  [WORK_ITEM_TYPE.EPIC, WORK_ITEM_TYPE.TASK],
  [WORK_ITEM_TYPE.TASK, WORK_ITEM_TYPE.SUBTASK],
  [WORK_ITEM_TYPE.SUBTASK, WORK_ITEM_TYPE.SUBTASK],
];

describe("adding a child", () => {
  it("presets parent and the level below on the board", () => {
    const { result } = renderHook(() => useTasksDialog(null, "all"), {
      wrapper,
    });

    for (const [type, childType] of LEVELS) {
      act(() => result.current.createSubtask(createWorkItem({ type })));
      expect(result.current.dialogState).toMatchObject({
        defaultParentId: "item-1",
        defaultType: childType,
        isOpen: true,
      });
    }
  });

  it("presets parent and the level below on the ticket page", () => {
    for (const [type, childType] of LEVELS) {
      const { result } = renderHook(
        () => useTicketDialogs(createWorkItem({ type }), "kanban"),
        { wrapper },
      );

      act(() => result.current.openCreateChild());
      expect(result.current.formDialog).toMatchObject({
        defaultParentId: "item-1",
        defaultType: childType,
      });
    }
  });

  it("gives the focus back to the card that opened the panel", async () => {
    const card = document.createElement("button");
    const panel = document.createElement("div");
    const inside = document.createElement("button");

    panel.setAttribute("role", "dialog");
    panel.append(inside);
    document.body.append(card, panel);

    const { result } = renderHook(() => useTasksDialog(null, "all"), {
      wrapper,
    });

    card.focus();
    act(() => result.current.openTask("PAGE-1"));
    inside.focus();
    act(() => result.current.openTask("PAGE-2"));
    act(() => result.current.closeDetail());

    await waitFor(() => expect(document.activeElement).toBe(card));

    act(() => result.current.closeDetail());
    expect(document.activeElement).toBe(card);
    card.remove();
    panel.remove();
  });
});
