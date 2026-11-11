import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, expect, it, vi } from "vitest";

import { ChatPageCreateDialog } from "@/app/components/chat-page/chat-page-create-dialog";
import { createI18n } from "@/app/lib/i18n";
import {
  VIRTUAL_GROUP_DESCRIPTION_LENGTH,
  VIRTUAL_GROUP_NAME_LENGTH,
} from "@/definition/VirtualChat";

import { participant } from "./chat-page-fixture";

interface FetcherStub {
  data: unknown;
  state: string;
  submit: ReturnType<
    typeof vi.fn<(formData: FormData, options: { method: string }) => void>
  >;
}

const fetcher = vi.hoisted<FetcherStub>(() => ({
  data: undefined,
  state: "idle",
  submit: vi.fn(),
}));
vi.mock("react-router", () => ({ useFetcher: () => fetcher }));

const i18n = createI18n("en");
const PEOPLE = [
  participant("ada", { name: "Ada" }),
  participant("bob", { name: "Bob", kind: "human" }),
];

interface Handlers {
  readonly onOpenChange: ReturnType<typeof vi.fn>;
  readonly onCreated: ReturnType<typeof vi.fn>;
  readonly rerender: () => void;
}

function renderDialog(
  options: { isOpen?: boolean; participants?: typeof PEOPLE } = {},
): Handlers {
  const onOpenChange = vi.fn();
  const onCreated = vi.fn();
  function content(): React.ReactElement {
    return (
      <I18nextProvider i18n={i18n}>
        <ChatPageCreateDialog
          isOpen={options.isOpen ?? true}
          participants={options.participants ?? PEOPLE}
          onOpenChange={onOpenChange}
          onCreated={onCreated}
        />
      </I18nextProvider>
    );
  }
  const rendered = render(content());
  return {
    onOpenChange,
    onCreated,
    rerender: () => rendered.rerender(content()),
  };
}

function fillName(value: string): void {
  fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
    target: { value },
  });
}

function submit(): void {
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
}

function submitted(): FormData {
  const call = fetcher.submit.mock.calls.at(-1);
  if (!call) throw new Error("nothing submitted");
  return call[0];
}

beforeEach(() => {
  fetcher.data = undefined;
  fetcher.state = "idle";
  fetcher.submit.mockReset();
});

it("renders nothing while closed", () => {
  renderDialog({ isOpen: false });
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("offers the fields with their length limits and one checkbox per participant", () => {
  renderDialog();
  expect(screen.getByRole("dialog").textContent).toContain("New group");
  expect(
    screen.getByRole("textbox", { name: "Name" }).getAttribute("maxlength"),
  ).toBe(String(VIRTUAL_GROUP_NAME_LENGTH));
  expect(
    screen
      .getByRole("textbox", { name: "Description" })
      .getAttribute("maxlength"),
  ).toBe(String(VIRTUAL_GROUP_DESCRIPTION_LENGTH));
  expect(
    screen.getAllByRole<HTMLInputElement>("checkbox").map((box) => box.checked),
  ).toEqual([false, false]);
  expect(screen.getByText("Ada")).toBeTruthy();
  expect(screen.getByText("Bob")).toBeTruthy();
});

it("tells that participants must be added first when the list is empty", () => {
  renderDialog({ participants: [] });
  expect(
    screen.getByText(
      "First add people or agents to your list with “Add participants”.",
    ),
  ).toBeTruthy();
  expect(screen.queryByRole("checkbox")).toBeNull();
});

it("refuses a blank name without submitting", () => {
  renderDialog();
  fillName("   ");
  fireEvent.click(screen.getAllByRole("checkbox")[0]);
  submit();
  expect(screen.getByRole("alert").textContent).toBe("Give the group a name.");
  expect(fetcher.submit).not.toHaveBeenCalled();
});

it("refuses a group without members", () => {
  renderDialog();
  fillName("Team");
  submit();
  expect(screen.getByRole("alert").textContent).toBe(
    "Choose at least one participant.",
  );
  expect(fetcher.submit).not.toHaveBeenCalled();
});

it("submits the trimmed values and the checked members by post", () => {
  renderDialog();
  fillName("  Team  ");
  fireEvent.change(screen.getByRole("textbox", { name: "Description" }), {
    target: { value: "  Daily work " },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: /Bob/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Ada/ }));
  submit();
  expect(fetcher.submit).toHaveBeenCalledTimes(1);
  expect(fetcher.submit.mock.calls[0]?.[1]).toEqual({ method: "post" });
  expect(Object.fromEntries(submitted())).toEqual({
    intent: "create-group",
    name: "Team",
    description: "Daily work",
    memberIds: JSON.stringify(["bob", "ada"]),
  });
  expect(screen.queryByRole("alert")).toBeNull();
});

it("removes a member again when its checkbox is unchecked", () => {
  renderDialog();
  fillName("Team");
  const ada = screen.getByRole("checkbox", { name: /Ada/ });
  fireEvent.click(ada);
  fireEvent.click(screen.getByRole("checkbox", { name: /Bob/ }));
  fireEvent.click(ada);
  submit();
  expect(Object.fromEntries(submitted()).memberIds).toBe(
    JSON.stringify(["bob"]),
  );
});

it("clears an earlier problem once the form is valid", () => {
  renderDialog();
  fillName(" ");
  submit();
  expect(screen.getByRole("alert")).toBeTruthy();
  fillName("Team");
  fireEvent.click(screen.getAllByRole("checkbox")[0]);
  submit();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("marks the create button pending while the save runs", () => {
  fetcher.state = "submitting";
  renderDialog();
  expect(screen.getByRole("button", { name: "Create" })).toHaveProperty(
    "disabled",
    true,
  );
});

it("reports the stored group once and not again on a rerender", () => {
  fetcher.data = { ok: true, groupId: "g1" };
  const { onCreated, rerender } = renderDialog();
  expect(onCreated).toHaveBeenCalledTimes(1);
  expect(onCreated).toHaveBeenCalledWith("g1");
  rerender();
  expect(onCreated).toHaveBeenCalledTimes(1);
});

it("waits with the report until the fetcher is idle again", () => {
  fetcher.data = { ok: true, groupId: "g1" };
  fetcher.state = "loading";
  const { onCreated, rerender } = renderDialog();
  expect(onCreated).not.toHaveBeenCalled();
  fetcher.state = "idle";
  rerender();
  expect(onCreated).toHaveBeenCalledWith("g1");
});

it("does not report a success without a group ID", () => {
  fetcher.data = { ok: true };
  const { onCreated } = renderDialog();
  expect(onCreated).not.toHaveBeenCalled();
});

it("keeps the dialog and its entered values after a failed save", () => {
  fetcher.data = { ok: false };
  const { onCreated } = renderDialog();
  expect(screen.getByRole("alert").textContent).toBe(
    "The group could not be saved.",
  );
  expect(onCreated).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBeTruthy();
});

it("ignores a fetcher answer that is no create result", () => {
  fetcher.data = "unexpected";
  const { onCreated } = renderDialog();
  expect(onCreated).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("asks to close through cancel", () => {
  const { onOpenChange } = renderDialog();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
});
