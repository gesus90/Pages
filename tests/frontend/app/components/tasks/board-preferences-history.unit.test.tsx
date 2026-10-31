import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, it } from "vitest";

import { useBoardPreferences } from "@/app/components/tasks/board/use-board-preferences";
import { DEFAULT_BOARD_PREFERENCES } from "@/definition/BoardPreferences";

function Search(): React.ReactElement {
  const board = useBoardPreferences(DEFAULT_BOARD_PREFERENCES);
  return (
    <input
      aria-label="Search"
      value={board.searchText}
      onChange={(event) => board.update({ search: event.target.value })}
    />
  );
}

it("shows the search from browser history after Back", async () => {
  const router = createMemoryRouter(
    [{ path: "/aufgaben", element: <Search /> }],
    {
      initialEntries: [
        "/aufgaben?view=kanban&q=first",
        "/aufgaben?view=kanban&q=second",
      ],
      initialIndex: 1,
    },
  );
  render(<RouterProvider router={router} />);
  expect(screen.getByRole("textbox", { name: "Search" })).toHaveProperty(
    "value",
    "second",
  );
  await router.navigate(-1);
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "Search" })).toHaveProperty(
      "value",
      "first",
    ),
  );
});
