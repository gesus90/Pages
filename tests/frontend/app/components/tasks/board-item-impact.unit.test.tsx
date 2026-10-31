import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useMemo } from "react";
import {
  createMemoryRouter,
  Form,
  RouterProvider,
  useLoaderData,
} from "react-router";
import { expect, it, vi } from "vitest";

import { useBoardItems } from "@/app/components/tasks/board/use-board-items";
import { workItem } from "../../lib/work-item-fixture";

import type { WorkItemDetail } from "@/definition/Task";

const parent = workItem("parent", { subtaskTotal: 1 });
const child = workItem("child", { parentId: parent.id });
const noRelated: readonly WorkItemDetail[] = [];

function Board({
  outside = null,
}: {
  readonly outside?: WorkItemDetail | null;
}): React.ReactElement {
  const items = useLoaderData<readonly WorkItemDetail[]>();
  const selection = useMemo(
    () =>
      outside
        ? {
            selectedItem: outside,
            selectedSubtasks: [],
            selectedHistory: [],
            selectedPullRequests: [],
            selectedChecklist: [],
            selectedLinks: [],
            selectedAttachments: [],
            selectedDescendants: null,
          }
        : null,
    [outside],
  );
  const updated = useBoardItems(
    items,
    {
      isFresh: outside !== null,
      isUnavailable: false,
      labelUsage: null,
      reload: () => undefined,
      labels: [],
      related: noRelated,
      selectedKey: null,
      selection,
    },
    outside ? "all" : "active",
  );
  return (
    <>
      {updated.map((item) => (
        <p key={item.id}>
          {item.id}: {item.subtaskTotal}
        </p>
      ))}
      <Form method="post">
        <button name="intent" type="submit" value="archive-task">
          Archive
        </button>
        <button name="intent" type="submit" value="create-task">
          Create
        </button>
        <button name="intent" type="submit" value="restore-task">
          Restore
        </button>
      </Form>
    </>
  );
}

function showBoard(
  outside: WorkItemDetail | null = null,
): ReturnType<typeof vi.fn> {
  const loader = vi.fn(() => [parent, child]);
  const router = createMemoryRouter(
    [
      {
        path: "/aufgaben",
        element: <Board outside={outside} />,
        loader,
        shouldRevalidate: () => false,
        action: async ({ request }) => {
          const intent = (await request.formData()).get("intent");
          if (intent === "archive-task")
            return {
              ok: true,
              intent,
              ticket: { ...child, archivedAt: "2026-01-01" },
              related: [{ ...parent, subtaskTotal: 0 }],
            };
          if (intent === "restore-task")
            return {
              ok: true,
              intent,
              ticket: workItem("restored"),
              related: [],
            };
          return {
            ok: true,
            intent: "create-task",
            ticket: workItem("new", { parentId: parent.id }),
            related: [{ ...parent, subtaskTotal: 2 }],
          };
        },
      },
    ],
    { initialEntries: ["/aufgaben?item=PAGE-child"] },
  );
  render(<RouterProvider router={router} />);
  return loader;
}

it("removes an archived card and updates its parent without reloading the board", async () => {
  const loader = showBoard();
  await screen.findByText("child: 0");
  fireEvent.click(screen.getByRole("button", { name: "Archive" }));
  await waitFor(() => expect(screen.queryByText("child: 0")).toBeNull());
  expect(screen.getByText("parent: 0")).toBeTruthy();
  expect(loader).toHaveBeenCalledTimes(1);
});

it("does not insert a separately selected ticket outside the loaded board scope", async () => {
  showBoard(workItem("outside", { archivedAt: "2026-01-01" }));
  await screen.findByText("child: 0");
  expect(screen.queryByText("outside: 0")).toBeNull();
});

it("adds a new card and updates its parent without reloading the board", async () => {
  const loader = showBoard();
  await screen.findByText("child: 0");
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  await screen.findByText("new: 0");
  expect(screen.getByText("parent: 2")).toBeTruthy();
  expect(loader).toHaveBeenCalledTimes(1);
});

it("adds a restored card that was outside the previous active scope", async () => {
  showBoard();
  await screen.findByText("child: 0");
  fireEvent.click(screen.getByRole("button", { name: "Restore" }));
  await screen.findByText("restored: 0");
});
