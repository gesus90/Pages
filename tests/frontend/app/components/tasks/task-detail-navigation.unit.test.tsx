import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { expect, it } from "vitest";

import { useTaskDetailNavigation } from "@/app/components/tasks/board/use-task-detail-navigation";

function Board(): React.ReactElement {
  const { search } = useLocation();
  const dialog = useTaskDetailNavigation(() => undefined);
  const selected = new URLSearchParams(search).get("item");
  return (
    <>
      <div data-testid="board">
        <button onClick={() => dialog.openTask("SYN-1")} type="button">
          Ticket
        </button>
      </div>
      {selected ? (
        <button onClick={dialog.closeDetail} type="button">
          Close {selected}
        </button>
      ) : null}
    </>
  );
}

it("keeps the board mounted and restores its complete address on close and Back", async () => {
  const address =
    "/aufgaben?view=kanban&q=needle&project=p1&sort=title&group=priority";
  const router = createMemoryRouter(
    [{ path: "/aufgaben", element: <Board /> }],
    { initialEntries: [address] },
  );
  render(<RouterProvider router={router} />);
  const board = screen.getByTestId("board");
  fireEvent.click(screen.getByRole("button", { name: "Ticket" }));
  await screen.findByRole("button", { name: "Close SYN-1" });
  expect(screen.getByTestId("board")).toBe(board);
  expect(router.state.location.search).toContain("item=SYN-1");
  fireEvent.click(screen.getByRole("button", { name: "Close SYN-1" }));
  await waitFor(() =>
    expect(router.state.location.search).toBe(
      "?view=kanban&q=needle&project=p1&sort=title&group=priority",
    ),
  );
  expect(screen.getByTestId("board")).toBe(board);
  fireEvent.click(screen.getByRole("button", { name: "Ticket" }));
  await screen.findByRole("button", { name: "Close SYN-1" });
  await router.navigate(-1);
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Close SYN-1" })).toBeNull(),
  );
  expect(screen.getByTestId("board")).toBe(board);
});

it("closes a directly addressed detail without leaving the board", async () => {
  const router = createMemoryRouter(
    [{ path: "/aufgaben", element: <Board /> }],
    {
      initialEntries: ["/aufgaben?view=kanban&item=SYN-1&q=needle"],
    },
  );
  render(<RouterProvider router={router} />);
  fireEvent.click(screen.getByRole("button", { name: "Close SYN-1" }));
  await waitFor(() =>
    expect(router.state.location.search).toBe("?view=kanban&q=needle"),
  );
});
