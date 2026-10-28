import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { PageAgentForm } from "@/app/components/agents/definitions/page-agent-form";
import { Dialog } from "@/app/components/ui/dialog";

import {
  heldAnswer,
  i18n,
  PAGE,
  pageAgent,
  renderAgentRoute,
} from "./page-agent-fixture";

// The rich-text editor needs a real layout engine; the form only hands it the markdown.
vi.mock("@/app/components/editor/block-editor", () => ({
  BlockEditor: (props: { readonly label: string }) => (
    <textarea aria-label={props.label} readOnly />
  ),
}));

function renderForm(
  answer?: Parameters<typeof renderAgentRoute>[1],
): ReturnType<typeof vi.fn> {
  const onSaved = vi.fn();
  renderAgentRoute(
    <Dialog open>
      <PageAgentForm agent={pageAgent()} page={PAGE} onSaved={onSaved} />
    </Dialog>,
    answer,
  );
  return onSaved;
}

function nameField(): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>("textbox", {
    name: i18n.t("pageAgents.name"),
  });
}

function cancelButton(): HTMLElement {
  return screen.getByRole("button", { name: i18n.t("settings.agents.cancel") });
}

/** Whether leaving the page now would ask the browser to confirm. */
function isLeaveGuarded(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

function pressEscape(): void {
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
}

it("guards leaving the page only while the draft differs from the saved agent", () => {
  renderForm();

  expect(isLeaveGuarded()).toBe(false);
  fireEvent.change(nameField(), { target: { value: "Reviewer v2" } });
  expect(isLeaveGuarded()).toBe(true);
  fireEvent.change(nameField(), { target: { value: "Reviewer" } });

  expect(isLeaveGuarded()).toBe(false);
});

it("closes an untouched form on Escape", () => {
  const onSaved = renderForm();

  pressEscape();

  expect(onSaved).toHaveBeenCalledOnce();
});

it("asks before Escape drops a changed draft", async () => {
  const onSaved = renderForm();

  fireEvent.change(nameField(), { target: { value: "Reviewer v2" } });
  pressEscape();

  expect(onSaved).not.toHaveBeenCalled();
  expect(
    await screen.findByText(i18n.t("settings.agents.definition.discardTitle")),
  ).toBeDefined();
});

it("ignores a close request while the save is pending", async () => {
  const held = heldAnswer();
  const onSaved = renderForm(held.answer);

  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("pageAgents.save") }),
  );
  await waitFor(() =>
    expect(cancelButton().hasAttribute("disabled")).toBe(true),
  );
  pressEscape();
  expect(onSaved).not.toHaveBeenCalled();
  expect(
    screen.queryByText(i18n.t("settings.agents.definition.discardTitle")),
  ).toBeNull();

  held.release({ ok: true, intent: "save-agent" });
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
});
