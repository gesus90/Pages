// @vitest-environment jsdom
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();

  return { ...actual, useFetcher: vi.fn() };
});

import { useFetcher } from "react-router";

import { createFakeFetcher, renderPlan } from "../helpers/plan-harness";
import { createLink, createMilestone } from "../helpers/plan-fixtures";

import type { FakeFetcher, RenderedPlan } from "../helpers/plan-harness";

const mockedUseFetcher = vi.mocked(useFetcher);

let saveFetcher: FakeFetcher;
let deleteFetcher: FakeFetcher;
let fetcherCalls = 0;

const KICKOFF = createMilestone({
  id: "m1",
  name: "Kickoff",
  startAt: "2026-09-10",
});
const REVIEW = createMilestone({
  dueAt: "2026-10-15",
  id: "m2",
  name: "Design Review",
  startAt: "2026-09-20",
});
const LAUNCH = createMilestone({
  id: "m3",
  name: "Launch",
  startAt: "2026-11-02",
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 30, 12));
  saveFetcher = createFakeFetcher();
  deleteFetcher = createFakeFetcher();
  fetcherCalls = 0;
  mockedUseFetcher.mockImplementation(
    () =>
      [saveFetcher, deleteFetcher][fetcherCalls++ % 2] as unknown as ReturnType<
        typeof useFetcher
      >,
  );
});

afterEach(() => {
  vi.useRealTimers();
});

function user(): ReturnType<typeof userEvent.setup> {
  return userEvent.setup();
}

function card(name: RegExp | string): HTMLElement {
  return screen.getByRole("button", { name });
}

function panel(): HTMLElement {
  return screen.getByRole("complementary", { name: "Meilenstein" });
}

function spectrumInput(): HTMLElement {
  return document.querySelector('input[type="color"]') as HTMLElement;
}

function hexInput(): HTMLElement {
  return document.querySelector(
    'input[aria-label="Eigene Farbe"]:not([type="color"])',
  ) as HTMLElement;
}

function saveButton(): HTMLElement {
  return within(panel()).getByRole("button", { name: "Speichern" });
}

function submitted(fetcher: FakeFetcher, call = 0): Record<string, string> {
  const formData = fetcher.submit.mock.calls[call]?.[0] as FormData;

  return Object.fromEntries(
    [...formData.entries()].map(([key, value]) => [key, String(value)]),
  );
}

async function openEdit(
  actor: ReturnType<typeof userEvent.setup>,
  name: RegExp | string,
): Promise<void> {
  await actor.click(card(name));
}

function answer(fetcher: FakeFetcher, ok: boolean, plan: RenderedPlan): void {
  fetcher.data = { ok };
  plan.refresh();
}

describe("creating a milestone", () => {
  it("opens an empty panel without dependencies", async () => {
    const actor = user();

    renderPlan({ milestones: [KICKOFF] });
    await actor.click(
      screen.getByRole("button", { name: "Meilenstein hinzufügen" }),
    );

    expect(within(panel()).getByLabelText("Name *")).toHaveValue("");
    expect(within(panel()).getByLabelText("Name *")).toHaveFocus();
    expect(within(panel()).getByLabelText("Startdatum *")).toHaveValue(
      "2026-09-30",
    );
    expect(within(panel()).getByText("Keine Änderungen.")).toBeInTheDocument();
    expect(within(panel()).queryByText("Abhängigkeiten")).toBeNull();
    expect(
      within(panel()).queryByRole("button", { name: "Meilenstein löschen" }),
    ).toBeNull();
    expect(saveButton()).toBeDisabled();
  });

  it("needs a name and a start date before saving", async () => {
    const actor = user();

    renderPlan({ milestones: [KICKOFF] });
    await actor.click(
      screen.getByRole("button", { name: "Meilenstein hinzufügen" }),
    );
    await actor.type(within(panel()).getByLabelText("Name *"), "Beta");

    expect(saveButton()).toBeEnabled();
    expect(within(panel()).queryByText("Keine Änderungen.")).toBeNull();

    fireEvent.change(within(panel()).getByLabelText("Startdatum *"), {
      target: { value: "" },
    });

    expect(saveButton()).toBeDisabled();
  });

  it("rejects an end date before the start date", async () => {
    const actor = user();

    renderPlan({ milestones: [KICKOFF] });
    await actor.click(
      screen.getByRole("button", { name: "Meilenstein hinzufügen" }),
    );
    await actor.type(within(panel()).getByLabelText("Name *"), "Beta");
    fireEvent.change(within(panel()).getByLabelText("Enddatum"), {
      target: { value: "2026-09-01" },
    });

    expect(within(panel()).getByRole("alert")).toHaveTextContent(
      "Das Enddatum darf nicht vor dem Startdatum liegen.",
    );
    expect(saveButton()).toBeDisabled();
  });

  it("shows the new milestone at once and confirms the save", async () => {
    const actor = user();
    const plan = renderPlan({ milestones: [KICKOFF] });

    await actor.click(
      screen.getByRole("button", { name: "Meilenstein hinzufügen" }),
    );
    await actor.type(within(panel()).getByLabelText("Name *"), "Beta Release");
    fireEvent.change(within(panel()).getByLabelText("Beschreibung"), {
      target: { value: "  Details " },
    });
    await actor.click(saveButton());

    expect(saveFetcher.submit).toHaveBeenCalledOnce();
    expect(submitted(saveFetcher)).toMatchObject({
      description: "  Details ",
      intent: "save-milestone",
      name: "Beta Release",
      startAt: "2026-09-30",
      status: "open",
    });
    expect(submitted(saveFetcher)).not.toHaveProperty("milestoneId");
    expect(card(/Beta Release/)).toBeDisabled();

    answer(saveFetcher, true, plan);

    expect(within(panel()).getByText("Keine Änderungen.")).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it("takes the new milestone back when the server refuses it", async () => {
    const actor = user();
    const plan = renderPlan({ milestones: [KICKOFF] });

    await actor.click(
      screen.getByRole("button", { name: "Meilenstein hinzufügen" }),
    );
    await actor.type(within(panel()).getByLabelText("Name *"), "Beta Release");
    await actor.click(saveButton());

    expect(card(/Beta Release/)).toBeInTheDocument();

    answer(saveFetcher, false, plan);

    expect(screen.queryByRole("button", { name: /Beta Release/ })).toBeNull();
    expect(within(panel()).getByRole("alert")).toHaveTextContent(
      "Speichern fehlgeschlagen. Die Änderung wurde zurückgesetzt.",
    );
  });

  it("ignores answers that belong to no save and unknown answers", async () => {
    const actor = user();
    const plan = renderPlan({ milestones: [KICKOFF] });

    saveFetcher.data = { ok: true };
    plan.refresh();
    await actor.click(
      screen.getByRole("button", { name: "Meilenstein hinzufügen" }),
    );
    await actor.type(within(panel()).getByLabelText("Name *"), "Beta");
    await actor.click(saveButton());

    saveFetcher.data = { unexpected: 1 };
    plan.refresh();

    expect(within(panel()).queryByRole("alert")).toBeNull();

    saveFetcher.state = "submitting";
    saveFetcher.data = { ok: false };
    plan.refresh();

    expect(within(panel()).queryByRole("alert")).toBeNull();
    expect(saveButton()).toBeDisabled();
  });
});

describe("editing a milestone", () => {
  it("opens the panel filled with the milestone and highlights its card", async () => {
    const actor = user();

    renderPlan({ milestones: [REVIEW] });
    await openEdit(actor, /Design Review/);

    expect(within(panel()).getByLabelText("Name *")).toHaveValue(
      "Design Review",
    );
    expect(within(panel()).getByLabelText("Startdatum *")).toHaveValue(
      "2026-09-20",
    );
    expect(within(panel()).getByLabelText("Enddatum")).toHaveValue(
      "2026-10-15",
    );
    expect(card(/Design Review/).className).toContain("border-primary");
  });

  it("saves the changes optimistically and confirms them", async () => {
    const actor = user();
    const plan = renderPlan({ milestones: [KICKOFF] });

    await openEdit(actor, /Kickoff/);
    await actor.type(within(panel()).getByLabelText("Name *"), " 2");
    await actor.click(saveButton());

    expect(submitted(saveFetcher)).toMatchObject({
      milestoneId: "m1",
      name: "Kickoff 2",
    });
    expect(submitted(saveFetcher)).not.toHaveProperty("addLinks");
    expect(card(/Kickoff 2/)).toBeInTheDocument();

    answer(saveFetcher, true, plan);

    expect(within(panel()).getByText("Keine Änderungen.")).toBeInTheDocument();
  });

  it("reverts the change when the save fails", async () => {
    const actor = user();
    const plan = renderPlan({ milestones: [KICKOFF] });

    await openEdit(actor, /Kickoff/);
    await actor.type(within(panel()).getByLabelText("Name *"), " 2");
    await actor.click(saveButton());
    answer(saveFetcher, false, plan);

    expect(card(/^Kickoff$|Kickoff\n/)).toBeInTheDocument();
    expect(within(panel()).getByRole("alert")).toHaveTextContent(
      "Speichern fehlgeschlagen",
    );
  });

  it("ignores a success that belongs to an earlier panel", async () => {
    const actor = user();
    const plan = renderPlan({ milestones: [KICKOFF] });

    await openEdit(actor, /Kickoff/);
    await actor.type(within(panel()).getByLabelText("Name *"), " 2");
    await actor.click(saveButton());
    await actor.click(
      within(panel()).getByRole("button", { name: "Abbrechen" }),
    );
    await openEdit(actor, /Kickoff 2/);
    answer(saveFetcher, true, plan);

    expect(within(panel()).getByLabelText("Name *")).toHaveValue("Kickoff 2");
  });

  it("changes the status through the select", async () => {
    const actor = user();

    renderPlan({ milestones: [KICKOFF] });
    await openEdit(actor, /Kickoff/);
    await actor.click(
      within(panel()).getByRole("combobox", { name: "Status" }),
    );
    await actor.click(
      await screen.findByRole("option", { name: "Archiviert" }),
    );

    expect(saveButton()).toBeEnabled();

    await actor.click(saveButton());

    expect(submitted(saveFetcher).status).toBe("archived");
  });

  it("fails cleanly when the milestone vanished from the server data", async () => {
    const actor = user();
    const plan = renderPlan({ milestones: [KICKOFF] });

    await openEdit(actor, /Kickoff/);
    plan.setProps({ milestones: [REVIEW] });
    await actor.type(within(panel()).getByLabelText("Name *"), " 2");
    await actor.click(saveButton());

    expect(saveFetcher.submit).not.toHaveBeenCalled();
    expect(within(panel()).getByRole("alert")).toHaveTextContent(
      "Speichern fehlgeschlagen",
    );
  });

  it("drops local changes when the loader data changes", async () => {
    const actor = user();
    const plan = renderPlan({ milestones: [KICKOFF] });

    await openEdit(actor, /Kickoff/);
    await actor.type(within(panel()).getByLabelText("Name *"), " 2");
    await actor.click(saveButton());

    expect(card(/Kickoff 2/)).toBeInTheDocument();

    plan.setProps({
      milestones: [createMilestone({ id: "m1", name: "Server name" })],
    });

    expect(card(/Server name/)).toBeInTheDocument();
  });

  it("disables saving while a save is running", async () => {
    const actor = user();
    const plan = renderPlan({ milestones: [KICKOFF] });

    await openEdit(actor, /Kickoff/);
    await actor.type(within(panel()).getByLabelText("Name *"), " 2");
    saveFetcher.state = "submitting";
    plan.refresh();

    expect(saveButton()).toBeDisabled();
  });

  it("lists milestones without date and opens them", async () => {
    const actor = user();

    renderPlan({
      milestones: [
        KICKOFF,
        createMilestone({
          dueAt: null,
          id: "u1",
          name: "Undated",
          startAt: null,
        }),
        createMilestone({
          dueAt: null,
          id: "u2",
          name: "Undated archived",
          startAt: null,
          status: "archived",
        }),
      ],
    });
    await actor.click(screen.getByRole("button", { name: "Undated" }));

    expect(within(panel()).getByLabelText("Name *")).toHaveValue("Undated");
    expect(
      screen.getByRole("button", { name: "Undated" }).closest("li")?.className,
    ).toContain("bg-primary-subtle");
  });
});

describe("closing the panel", () => {
  it.each([
    [
      "the close button",
      async (actor: ReturnType<typeof userEvent.setup>) =>
        actor.click(
          within(panel()).getByRole("button", { name: "Panel schließen" }),
        ),
    ],
    [
      "the cancel button",
      async (actor: ReturnType<typeof userEvent.setup>) =>
        actor.click(within(panel()).getByRole("button", { name: "Abbrechen" })),
    ],
    [
      "Escape",
      async (actor: ReturnType<typeof userEvent.setup>) =>
        actor.keyboard("{Escape}"),
    ],
  ])("closes with %s", async (_label, close) => {
    const actor = user();

    renderPlan({ milestones: [KICKOFF] });
    await openEdit(actor, /Kickoff/);
    await close(actor);

    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("closes when the timeline background is clicked", async () => {
    const actor = user();

    renderPlan({ milestones: [KICKOFF] });
    await openEdit(actor, /Kickoff/);
    await actor.click(
      document.querySelector(".pages-thin-scrollbar .relative") as HTMLElement,
    );

    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("keeps other keys from closing it", async () => {
    const actor = user();

    renderPlan({ milestones: [KICKOFF] });
    await openEdit(actor, /Kickoff/);
    await actor.keyboard("a");

    expect(panel()).toBeInTheDocument();
  });
});

describe("dependencies", () => {
  const MILESTONES = [KICKOFF, REVIEW, LAUNCH];

  async function linkTo(
    actor: ReturnType<typeof userEvent.setup>,
    name: string,
  ): Promise<void> {
    await actor.click(
      within(panel()).getByRole("button", { name: "Meilenstein auswählen …" }),
    );
    await actor.click(await screen.findByRole("button", { name }));
    await actor.click(
      within(panel()).getByRole("button", { name: "Abhängigkeit hinzufügen" }),
    );
  }

  it("lists the outgoing links of the milestone", async () => {
    const actor = user();

    renderPlan({
      milestoneLinks: [
        createLink({ id: "l1", sourceId: "m1", targetId: "m2" }),
      ],
      milestones: MILESTONES,
    });
    await openEdit(actor, /Kickoff/);

    expect(within(panel()).getByText("Design Review")).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it("offers neither itself, linked, pending nor incoming milestones", async () => {
    const actor = user();

    renderPlan({
      milestoneLinks: [
        createLink({ id: "l1", sourceId: "m1", targetId: "m2" }),
        createLink({ id: "l2", sourceId: "m3", targetId: "m1" }),
      ],
      milestones: [
        ...MILESTONES,
        createMilestone({
          id: "pending-9",
          name: "Pending",
          startAt: "2026-09-25",
        }),
      ],
    });
    await openEdit(actor, /Kickoff/);
    await actor.click(
      within(panel()).getByRole("button", { name: "Meilenstein auswählen …" }),
    );

    expect(
      screen.getByText("Meilenstein suchen …", { selector: "li" }),
    ).toBeInTheDocument();
  });

  it("adds a link, sends it with the save and closes the panel afterwards", async () => {
    const actor = user();
    const plan = renderPlan({ milestones: MILESTONES });

    await openEdit(actor, /Kickoff/);
    await linkTo(actor, "Launch");

    expect(
      within(panel()).getByRole("button", { name: "Launch" }),
    ).toBeInTheDocument();
    expect(saveButton()).toBeEnabled();

    await actor.click(saveButton());

    expect(submitted(saveFetcher).addLinks).toBe(
      JSON.stringify([{ linkType: "prerequisite", targetId: "m3" }]),
    );
    expect(submitted(saveFetcher).removeLinks).toBe("[]");
    expect(
      document.querySelectorAll("svg path[stroke^='url(#plan-grad-']"),
    ).toHaveLength(1);

    answer(saveFetcher, true, plan);

    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("reverts links and reports a dependency error when the save fails", async () => {
    const actor = user();
    const plan = renderPlan({
      milestoneLinks: [
        createLink({ id: "l1", sourceId: "m1", targetId: "m2" }),
      ],
      milestones: MILESTONES,
    });

    await openEdit(actor, /Kickoff/);
    await actor.click(
      within(panel()).getByRole("button", { name: "Design Review" }),
    );
    await linkTo(actor, "Launch");
    await actor.click(saveButton());

    expect(submitted(saveFetcher).removeLinks).toBe(JSON.stringify(["l1"]));

    answer(saveFetcher, false, plan);

    expect(within(panel()).getByRole("alert")).toHaveTextContent(
      "Abhängigkeit konnte nicht gespeichert werden.",
    );
    expect(
      within(panel()).getByRole("button", { name: "Design Review" }),
    ).toBeInTheDocument();
    expect(
      within(panel()).queryByRole("button", { name: "Launch" }),
    ).toBeNull();
    expect(
      document.querySelectorAll("svg path[stroke^='url(#plan-grad-']"),
    ).toHaveLength(1);
  });

  it("removes a link that was only added in the panel", async () => {
    const actor = user();

    renderPlan({ milestones: MILESTONES });
    await openEdit(actor, /Kickoff/);
    await linkTo(actor, "Launch");
    await actor.click(within(panel()).getByRole("button", { name: "Launch" }));

    expect(
      within(panel()).queryByRole("button", { name: "Launch" }),
    ).toBeNull();
    expect(saveButton()).toBeDisabled();
  });

  it("filters the target picker by search text", async () => {
    const actor = user();

    renderPlan({ milestones: MILESTONES });
    await openEdit(actor, /Kickoff/);
    await actor.click(
      within(panel()).getByRole("button", { name: "Meilenstein auswählen …" }),
    );

    expect(
      screen.getByRole("textbox", { name: "Meilenstein suchen …" }),
    ).toHaveFocus();

    await actor.keyboard("laun");

    expect(screen.getByRole("button", { name: "Launch" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Design Review" })).toBeNull();

    await actor.keyboard("{Escape}");

    expect(
      screen.queryByRole("textbox", { name: "Meilenstein suchen …" }),
    ).toBeNull();
    expect(panel()).toBeInTheDocument();
  });

  it("closes the target picker through its backdrop", async () => {
    const actor = user();

    renderPlan({ milestones: MILESTONES });
    await openEdit(actor, /Kickoff/);
    await actor.click(
      within(panel()).getByRole("button", { name: "Meilenstein auswählen …" }),
    );
    await actor.click(
      screen.getAllByRole("button", {
        name: "Meilenstein auswählen …",
      })[1] as HTMLElement,
    );

    expect(
      screen.queryByRole("textbox", { name: "Meilenstein suchen …" }),
    ).toBeNull();
  });

  it("keeps the add button disabled until a target is chosen", async () => {
    const actor = user();

    renderPlan({ milestones: MILESTONES });
    await openEdit(actor, /Kickoff/);

    expect(
      within(panel()).getByRole("button", { name: "Abhängigkeit hinzufügen" }),
    ).toBeDisabled();
  });
});

describe("deleting a milestone", () => {
  const MILESTONES = [KICKOFF, REVIEW];

  async function confirmDelete(
    actor: ReturnType<typeof userEvent.setup>,
  ): Promise<void> {
    await actor.click(
      within(panel()).getByRole("button", { name: "Meilenstein löschen" }),
    );
    await actor.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Löschen",
      }),
    );
  }

  it("asks for confirmation and can be cancelled", async () => {
    const actor = user();

    renderPlan({ milestones: MILESTONES });
    await openEdit(actor, /Kickoff/);
    await actor.click(
      within(panel()).getByRole("button", { name: "Meilenstein löschen" }),
    );

    const dialog = await screen.findByRole("dialog");

    expect(dialog).toHaveTextContent(
      "Der Meilenstein „Kickoff“ wird dauerhaft gelöscht.",
    );
    expect(dialog).not.toHaveTextContent("Verknüpfungen");

    await actor.click(
      within(dialog).getByRole("button", { name: "Abbrechen" }),
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(deleteFetcher.submit).not.toHaveBeenCalled();
  });

  it("mentions links that will be removed too", async () => {
    const actor = user();

    renderPlan({
      milestoneLinks: [createLink()],
      milestones: [KICKOFF, createMilestone({ id: "m2", name: "Two" })],
    });
    await openEdit(actor, /Kickoff/);
    await actor.click(
      within(panel()).getByRole("button", { name: "Meilenstein löschen" }),
    );

    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "Verknüpfungen",
    );
  });

  it("removes the milestone at once and closes the panel on success", async () => {
    const actor = user();
    const plan = renderPlan({ milestones: MILESTONES });

    await openEdit(actor, /Kickoff/);
    await confirmDelete(actor);

    expect(submitted(deleteFetcher)).toEqual({
      intent: "delete-milestone",
      milestoneId: "m1",
    });
    expect(screen.queryByRole("button", { name: /Kickoff/ })).toBeNull();

    answer(deleteFetcher, true, plan);

    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("keeps another open panel when a different milestone was deleted", async () => {
    const actor = user();
    const plan = renderPlan({ milestones: MILESTONES });

    await openEdit(actor, /Kickoff/);
    await confirmDelete(actor);
    await actor.click(card(/Design Review/));
    answer(deleteFetcher, true, plan);

    expect(panel()).toBeInTheDocument();
  });

  it("restores the milestone when the delete fails", async () => {
    const actor = user();
    const plan = renderPlan({ milestones: MILESTONES });

    await openEdit(actor, /Kickoff/);
    await confirmDelete(actor);
    answer(deleteFetcher, false, plan);

    expect(card(/Kickoff/)).toBeInTheDocument();
    expect(within(panel()).getByRole("alert")).toHaveTextContent(
      "Speichern fehlgeschlagen",
    );
  });

  it("disables the confirmation while a delete is running", async () => {
    const actor = user();
    const plan = renderPlan({ milestones: MILESTONES });

    await openEdit(actor, /Kickoff/);
    await actor.click(
      within(panel()).getByRole("button", { name: "Meilenstein löschen" }),
    );
    deleteFetcher.state = "submitting";
    plan.refresh();

    expect(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Löschen",
      }),
    ).toBeDisabled();
  });
});

describe("symbol and color", () => {
  async function openPicker(
    actor: ReturnType<typeof userEvent.setup>,
  ): Promise<void> {
    await actor.click(within(panel()).getByRole("button", { name: "Symbol" }));
  }

  it("previews a chosen symbol on the timeline and reverts it on close", async () => {
    const actor = user();

    renderPlan({ milestones: [KICKOFF] });
    await openEdit(actor, /Kickoff/);
    await openPicker(actor);
    await actor.click(screen.getByRole("button", { name: "Rakete" }));

    expect(card(/Kickoff/).querySelector(".lucide-rocket")).not.toBeNull();
    expect(saveButton()).toBeEnabled();

    await actor.keyboard("{Escape}");
    await actor.click(
      within(panel()).getByRole("button", { name: "Panel schließen" }),
    );

    expect(card(/Kickoff/).querySelector(".lucide-rocket")).toBeNull();
  });

  it("previews preset, spectrum and typed colors", async () => {
    const actor = user();

    renderPlan({ milestones: [KICKOFF] });
    await openEdit(actor, /Kickoff/);
    await openPicker(actor);
    await actor.click(screen.getByRole("button", { name: "Rot" }));

    expect(screen.getByRole("button", { name: "Rot" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.change(spectrumInput(), {
      target: { value: "#123456" },
    });

    expect(hexInput()).toHaveValue("#123456");

    await actor.clear(hexInput());
    await actor.type(hexInput(), "#abc");

    expect(hexInput()).toHaveValue("#abc");

    await actor.type(hexInput(), "zz");

    expect(hexInput()).toHaveValue("#abczz");
  });

  it("starts the custom color field from the stored color", async () => {
    const actor = user();

    renderPlan({
      milestones: [
        createMilestone({ colorCustom: "#abc", id: "m1", name: "Kickoff" }),
      ],
    });
    await openEdit(actor, /Kickoff/);
    await openPicker(actor);

    expect(hexInput()).toHaveValue("#aabbcc");
  });

  it("closes the picker first and the panel second with Escape", async () => {
    const actor = user();

    renderPlan({ milestones: [KICKOFF] });
    await openEdit(actor, /Kickoff/);
    await openPicker(actor);
    await actor.keyboard("{Escape}");

    expect(screen.queryByRole("button", { name: "Rakete" })).toBeNull();
    expect(panel()).toBeInTheDocument();

    await actor.keyboard("{Escape}");

    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("closes the picker through its backdrop and toggles it", async () => {
    const actor = user();

    renderPlan({ milestones: [KICKOFF] });
    await openEdit(actor, /Kickoff/);
    await openPicker(actor);

    expect(
      within(panel()).getByRole("button", { name: "Symbol" }),
    ).toHaveAttribute("aria-expanded", "true");

    await actor.click(
      screen.getAllByRole("button", {
        name: "Panel schließen",
      })[0] as HTMLElement,
    );

    expect(screen.queryByRole("button", { name: "Rakete" })).toBeNull();

    await openPicker(actor);
    await openPicker(actor);

    expect(screen.queryByRole("button", { name: "Rakete" })).toBeNull();
  });

  it("does not preview for a milestone that is still being created", async () => {
    const actor = user();

    renderPlan({ milestones: [KICKOFF] });
    await actor.click(
      screen.getByRole("button", { name: "Meilenstein hinzufügen" }),
    );
    await openPicker(actor);
    await actor.click(screen.getByRole("button", { name: "Rakete" }));

    expect(card(/Kickoff/).querySelector(".lucide-rocket")).toBeNull();
    expect(saveButton()).toBeDisabled();
  });

  it("does not preview while a save of the milestone is running", async () => {
    const actor = user();

    renderPlan({ milestones: [KICKOFF] });
    await openEdit(actor, /Kickoff/);
    await actor.type(within(panel()).getByLabelText("Name *"), " 2");
    await actor.click(saveButton());
    await openPicker(actor);
    await actor.click(screen.getByRole("button", { name: "Rakete" }));

    expect(card(/Kickoff 2/).querySelector(".lucide-rocket")).toBeNull();
  });

  it("does not preview for a milestone that vanished from the server data", async () => {
    const actor = user();
    const plan = renderPlan({ milestones: [KICKOFF] });

    await openEdit(actor, /Kickoff/);
    plan.setProps({ milestones: [REVIEW] });
    await openPicker(actor);
    await actor.click(screen.getByRole("button", { name: "Rakete" }));

    expect(card(/Design Review/).querySelector(".lucide-rocket")).toBeNull();
  });
});
