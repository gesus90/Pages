import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createMemoryRouter,
  Form,
  RouterProvider,
  useLoaderData,
  useSearchParams,
} from "react-router";
import { expect, it } from "vitest";

import { useTasksDialog } from "@/app/components/tasks/board/use-tasks-dialog";

function Board(): React.ReactElement {
  const loaded = useLoaderData<{ readonly count: number }>();
  const [params] = useSearchParams();
  useTasksDialog(params.get("item"), "all");
  return (
    <>
      <p>Cards: {loaded.count}</p>
      <Form method="post">
        <button name="intent" type="submit" value="archive-task">
          Archive
        </button>
      </Form>
    </>
  );
}

it("waits for the archive revalidation before closing the selected ticket", async () => {
  let release: (() => void) | undefined;
  const revalidation = new Promise<{ readonly count: number }>((resolve) => {
    release = () => resolve({ count: 0 });
  });
  const router = createMemoryRouter(
    [
      {
        id: "board",
        path: "/aufgaben",
        element: <Board />,
        loader: () => revalidation,
        action: () => ({ ok: true, intent: "archive-task" }),
      },
    ],
    {
      initialEntries: ["/aufgaben?view=kanban&item=SYN-1"],
      hydrationData: { loaderData: { board: { count: 1 } } },
    },
  );
  render(<RouterProvider router={router} />);
  fireEvent.click(screen.getByRole("button", { name: "Archive" }));
  await waitFor(() => expect(router.state.navigation.state).toBe("loading"));
  expect(router.state.location.search).toContain("item=SYN-1");
  release?.();
  await waitFor(() =>
    expect(router.state.location.search).not.toContain("item="),
  );
  expect(screen.getByText("Cards: 0")).toBeTruthy();
});
