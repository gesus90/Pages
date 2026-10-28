import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { createMemoryRouter, Link, RouterProvider } from "react-router";
import { expect, it, vi } from "vitest";

import { PlanLeaveGuard } from "@/app/components/agents/plans/plan-leave-guard";

import { i18n, renderTranslated } from "./plan-group-fixture";

import type * as DialogModule from "@/app/components/ui/dialog";

// The real dialog, recording how it reports open changes; no trigger of these dialogs ever asks to open.
const openChanges = vi.hoisted(() => {
  const changes: ((open: boolean) => void)[] = [];
  return changes;
});
vi.mock("@/app/components/ui/dialog", async (importOriginal) => {
  const actual = await importOriginal<typeof DialogModule>();
  function Dialog(
    props: React.ComponentProps<typeof actual.Dialog>,
  ): React.ReactElement {
    if (props.onOpenChange) openChanges.push(props.onOpenChange);
    return <actual.Dialog {...props} />;
  }
  return { ...actual, Dialog };
});

function Editor(): React.ReactElement {
  const [isDirty, setDirty] = useState(true);
  return (
    <>
      <label>
        <input
          type="checkbox"
          checked={isDirty}
          onChange={(event) => setDirty(event.target.checked)}
        />
        dirty
      </label>
      <Link to="/other">Leave</Link>
      <PlanLeaveGuard isDirty={isDirty} />
    </>
  );
}

function renderEditor(): void {
  const router = createMemoryRouter(
    [
      { path: "/plan", element: <Editor /> },
      { path: "/other", element: <p>Other page</p> },
    ],
    { initialEntries: ["/plan"] },
  );
  renderTranslated(<RouterProvider router={router} />);
}

function unload(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

it("asks before leaving an unsaved plan and stays on cancel", async () => {
  renderEditor();
  fireEvent.click(screen.getByRole("link", { name: "Leave" }));
  const dialog = await screen.findByRole("dialog", {
    name: i18n.t("plans.discardTitle"),
  });
  expect(dialog.textContent).toContain(i18n.t("plans.discardHint"));
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("settings.agents.cancel") }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByRole("link", { name: "Leave" })).toBeTruthy();
  expect(screen.queryByText("Other page")).toBeNull();
});

it("leaves the unsaved plan once the person discards it", async () => {
  renderEditor();
  fireEvent.click(screen.getByRole("link", { name: "Leave" }));
  fireEvent.click(
    await screen.findByRole("button", {
      name: i18n.t("settings.agents.definition.discard"),
    }),
  );
  expect(await screen.findByText("Other page")).toBeTruthy();
});

it("warns before closing the tab only while the plan is unsaved", async () => {
  renderEditor();
  expect(unload()).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "dirty" }));
  expect(unload()).toBe(false);
  // A saved plan leaves without a question.
  fireEvent.click(screen.getByRole("link", { name: "Leave" }));
  expect(await screen.findByText("Other page")).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("keeps the question open when the dialog only reports that it is open", async () => {
  renderEditor();
  fireEvent.click(screen.getByRole("link", { name: "Leave" }));
  await screen.findByRole("dialog");
  openChanges.at(-1)?.(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.queryByText("Other page")).toBeNull();
});
