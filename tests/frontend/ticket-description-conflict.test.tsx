// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createMemoryRouter,
  data,
  RouterProvider,
  useLoaderData,
} from "react-router";
import { describe, expect, it } from "vitest";

import { useTicketDescription } from "@/app/components/tasks/description/use-ticket-description";

interface Ticket {
  readonly id: string;
  readonly description: string;
}

function DescriptionHarness(): React.ReactElement {
  const ticket = useLoaderData<Ticket>();
  const state = useTicketDescription(ticket);

  return (
    <>
      <textarea
        aria-label="Draft"
        onChange={(event) => state.change(event.target.value)}
        value={state.draft}
      />
      <p>{state.status}</p>
      <p aria-label="Stored">{ticket.description}</p>
      <button onClick={state.startEditing} type="button">
        Edit
      </button>
      <button onClick={() => state.save()} type="button">
        Save
      </button>
      <button onClick={state.takeLatest} type="button">
        Load latest
      </button>
      <button onClick={() => state.save(true)} type="button">
        Overwrite
      </button>
    </>
  );
}

describe("ticket description conflicts with real router responses", () => {
  it.each(["Load latest", "Overwrite"])(
    "reloads the latest text after HTTP 400 before %s",
    async (resolution) => {
      let storedDescription = "Original";
      let hasStartedReload = false;
      let releaseReload = (): void => undefined;
      const reloadReady = new Promise<void>((resolve) => {
        releaseReload = resolve;
      });
      const router = createMemoryRouter([
        {
          element: <DescriptionHarness />,
          async loader() {
            if (storedDescription !== "Original") {
              hasStartedReload = true;
              await reloadReady;
            }

            return { description: storedDescription, id: "ticket-1" };
          },
          path: "/",
        },
        {
          async action({ request }) {
            const form = await request.formData();

            if (form.get("baseDescription") !== storedDescription) {
              return data(
                { error: "descriptionConflict", ok: false },
                { status: 400 },
              );
            }

            storedDescription = String(form.get("description"));

            return { ok: true };
          },
          path: "/aufgaben",
        },
      ]);

      render(<RouterProvider router={router} />);
      await userEvent.click(
        await screen.findByRole("button", { name: "Edit" }),
      );
      await userEvent.clear(screen.getByRole("textbox"));
      await userEvent.type(screen.getByRole("textbox"), "My draft");
      storedDescription = "Saved by another person";
      await userEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(hasStartedReload).toBe(true));

      try {
        expect(screen.queryByText("conflict")).not.toBeInTheDocument();
        expect(screen.getByText("saving")).toBeVisible();
        expect(screen.getByRole("textbox")).toHaveValue("My draft");
      } finally {
        await act(async () => releaseReload());
      }

      await screen.findByText("conflict");
      expect(screen.getByRole("textbox")).toHaveValue("My draft");
      await waitFor(() => {
        expect(screen.getByLabelText("Stored")).toHaveTextContent(
          "Saved by another person",
        );
      });
      await userEvent.click(screen.getByRole("button", { name: resolution }));

      if (resolution === "Load latest") {
        expect(screen.getByRole("textbox")).toHaveValue(
          "Saved by another person",
        );
        expect(storedDescription).toBe("Saved by another person");
      } else {
        await screen.findByText("saved");
        expect(storedDescription).toBe("My draft");
      }

      router.dispose();
    },
  );
});
