import { fireEvent, render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, expect, it, vi } from "vitest";

import { ChatPageContactDialog } from "@/app/components/chat-page/chat-page-contact-dialog";
import { createI18n } from "@/app/lib/i18n";

import type { ComponentProps } from "react";
import type { VirtualContactChoice } from "@/definition/VirtualChat";

const fetcher = vi.hoisted(() => ({
  data: undefined as { readonly ok: boolean } | undefined,
  state: "idle",
  submit: vi.fn<(formData: FormData, options: { method: string }) => void>(),
}));
vi.mock("react-router", () => ({
  useFetcher: () => fetcher,
  Link: ({ to, children, ...rest }: ComponentProps<"a"> & { to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const i18n = createI18n("en");

function choice(
  id: string,
  overrides: Partial<VirtualContactChoice> = {},
): VirtualContactChoice {
  return {
    id,
    name: `Name ${id}`,
    kind: "agent",
    subtitle: `Role ${id}`,
    color: null,
    avatarImageUrl: null,
    isSelectable: true,
    ...overrides,
  };
}

const CHOICES = [
  choice("ada", { name: "Ada", subtitle: "Planner" }),
  choice("bob", { name: "Bob", kind: "human", subtitle: "bobby" }),
  choice("old", { name: "Oldie", subtitle: "Retired", isSelectable: false }),
];

interface Rendered {
  readonly onOpenChange: ReturnType<typeof vi.fn>;
  readonly update: (
    props: Partial<ComponentProps<typeof ChatPageContactDialog>>,
  ) => void;
}

function renderDialog(
  props: Partial<ComponentProps<typeof ChatPageContactDialog>> = {},
): Rendered {
  const onOpenChange = vi.fn();
  function content(
    override: Partial<ComponentProps<typeof ChatPageContactDialog>>,
  ): React.ReactElement {
    return (
      <I18nextProvider i18n={i18n}>
        <ChatPageContactDialog
          isOpen
          onOpenChange={onOpenChange}
          choices={CHOICES}
          selectedIds={[]}
          {...props}
          {...override}
        />
      </I18nextProvider>
    );
  }
  const rendered = render(content({}));
  return {
    onOpenChange,
    update: (override) => rendered.rerender(content(override)),
  };
}

function box(name: string): HTMLInputElement {
  return screen.getByRole("checkbox", { name });
}

function save(): void {
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
}

function savedContacts(): unknown {
  const call = fetcher.submit.mock.calls.at(-1);
  if (!call) throw new Error("nothing submitted");
  expect(call[1]).toEqual({ method: "post" });
  expect(call[0].get("intent")).toBe("save-contacts");
  return JSON.parse(String(call[0].get("contacts")));
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

it("sorts the choices into people and agents with their subtitles", () => {
  renderDialog();
  const people = within(screen.getByRole("region", { name: "People" }));
  const agents = within(screen.getByRole("region", { name: "Agents" }));
  expect(people.getByText("Bob")).toBeTruthy();
  expect(people.getByText("@bobby")).toBeTruthy();
  expect(agents.getByText("Ada")).toBeTruthy();
  expect(agents.getByText("Planner")).toBeTruthy();
  expect(agents.getByText("Deactivated")).toBeTruthy();
  expect(agents.queryByText("Retired")).toBeNull();
});

it("omits a section without choices", () => {
  renderDialog({ choices: [CHOICES[0]] });
  expect(screen.queryByRole("region", { name: "People" })).toBeNull();
  expect(screen.getByRole("region", { name: "Agents" })).toBeTruthy();
});

it("checks the list now and blocks a deactivated agent that is not in it", () => {
  renderDialog({ selectedIds: ["ada"] });
  expect(box("Ada").checked).toBe(true);
  expect(box("Bob").checked).toBe(false);
  expect(box("Oldie").disabled).toBe(true);
  expect(box("Ada").disabled).toBe(false);
});

it("lets a deactivated agent in the list be removed", () => {
  renderDialog({ selectedIds: ["old"] });
  expect(box("Oldie").checked).toBe(true);
  expect(box("Oldie").disabled).toBe(false);
  fireEvent.click(box("Oldie"));
  expect(box("Oldie").checked).toBe(false);
});

it("filters by name and subtitle without regard to case", () => {
  renderDialog();
  const search = screen.getByRole("searchbox");
  fireEvent.change(search, { target: { value: "  PLAN " } });
  expect(screen.getByText("Ada")).toBeTruthy();
  expect(screen.queryByText("Bob")).toBeNull();
  fireEvent.change(search, { target: { value: "bob" } });
  expect(screen.getByText("Bob")).toBeTruthy();
  expect(screen.queryByText("Ada")).toBeNull();
});

it("says so when the search matches nothing", () => {
  renderDialog();
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "zzz" },
  });
  expect(screen.getByText("No matches.")).toBeTruthy();
  expect(screen.queryByRole("checkbox")).toBeNull();
});

it("points to the user administration for new agents", () => {
  renderDialog();
  expect(
    screen
      .getByRole("link", { name: "user administration" })
      .getAttribute("href"),
  ).toBe("/users");
});

it("saves kept entries, also unknown ones, in their place and new ones after them", () => {
  renderDialog({ selectedIds: ["x", "ada", "y"] });
  fireEvent.click(box("Ada"));
  fireEvent.click(box("Bob"));
  save();
  expect(savedContacts()).toEqual(["x", "y", "bob"]);
});

it("keeps the order of the list when an entry is unchecked and checked again", () => {
  renderDialog({ selectedIds: ["bob", "ada"] });
  fireEvent.click(box("Bob"));
  fireEvent.click(box("Bob"));
  save();
  expect(savedContacts()).toEqual(["bob", "ada"]);
});

it("saves an empty list when everything is unchecked", () => {
  renderDialog({ selectedIds: ["ada"] });
  fireEvent.click(box("Ada"));
  save();
  expect(savedContacts()).toEqual([]);
});

it("takes a new list from the parent at the next opening", () => {
  const { update } = renderDialog({ isOpen: false, selectedIds: [] });
  update({ isOpen: true, selectedIds: ["ada", "bob"] });
  expect(box("Ada").checked).toBe(true);
  expect(box("Bob").checked).toBe(true);
});

it("restarts from the stored list after the dialog reopens", () => {
  const { update } = renderDialog({ selectedIds: ["ada"] });
  fireEvent.click(box("Bob"));
  update({ isOpen: false });
  update({ isOpen: true, selectedIds: ["ada"] });
  expect(box("Bob").checked).toBe(false);
  expect(box("Ada").checked).toBe(true);
});

it("marks the save button pending while the list is stored", () => {
  fetcher.state = "submitting";
  renderDialog();
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty(
    "disabled",
    true,
  );
});

it("closes once after a saved answer", () => {
  fetcher.data = { ok: true };
  const { onOpenChange, update } = renderDialog();
  expect(onOpenChange).toHaveBeenCalledTimes(1);
  expect(onOpenChange).toHaveBeenCalledWith(false);
  update({});
  expect(onOpenChange).toHaveBeenCalledTimes(1);
});

it("waits for the idle fetcher before closing", () => {
  fetcher.data = { ok: true };
  fetcher.state = "loading";
  const { onOpenChange, update } = renderDialog();
  expect(onOpenChange).not.toHaveBeenCalled();
  fetcher.state = "idle";
  update({});
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it("stays open and shows an alert when the list could not be saved", () => {
  fetcher.data = { ok: false };
  const { onOpenChange } = renderDialog();
  expect(screen.getByRole("alert").textContent).toBe(
    "The list could not be saved.",
  );
  expect(onOpenChange).not.toHaveBeenCalled();
});

it("shows no alert before any answer", () => {
  renderDialog();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("asks to close through cancel", () => {
  const { onOpenChange } = renderDialog();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
});
