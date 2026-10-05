// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();

  return { ...actual, useFetcher: vi.fn() };
});

import { useFetcher } from "react-router";

import {
  createFakeFetcher,
  installLayout,
  renderPlan,
} from "../helpers/plan-harness";
import { createLink, createMilestone } from "../helpers/plan-fixtures";

import type { FakeFetcher } from "../helpers/plan-harness";

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
const BACKEND = createMilestone({
  dueAt: "2026-10-05",
  id: "m3",
  name: "Backend",
  startAt: "2026-10-01",
});
const UNDATED = createMilestone({
  dueAt: null,
  id: "m4",
  name: "Ohne Termin",
  startAt: null,
});
const ALL = [KICKOFF, REVIEW, BACKEND, UNDATED];

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

function card(name: RegExp | string): HTMLElement {
  return screen.getByRole("button", { name });
}

describe("PhaseMilestonePlan timeline", () => {
  it("explains that nothing is planned yet", () => {
    renderPlan();

    expect(
      screen.getByText("Noch keine Meilensteine geplant."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Heute")).toBeNull();
  });

  it("shows only undated milestones in their own list", () => {
    renderPlan({ milestones: [UNDATED] });

    expect(screen.getByText("Ohne Datum")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Ohne Termin" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Noch keine Meilensteine geplant."),
    ).toBeInTheDocument();
  });

  it("places dated milestones in their lanes with a marker for today", () => {
    renderPlan({ milestones: ALL });

    expect(screen.getByText("Produkt")).toBeInTheDocument();
    expect(screen.getByText("Design")).toBeInTheDocument();
    expect(screen.getByText("Entwicklung")).toBeInTheDocument();
    expect(card(/Kickoff/)).toBeInTheDocument();
    expect(card(/Design Review/)).toHaveAttribute(
      "title",
      expect.stringContaining("20.09. – 15.10.2026"),
    );
    expect(screen.getByText("Heute")).toBeInTheDocument();
    expect(screen.getByText("KW 40")).toBeInTheDocument();
  });

  it("labels completed and archived milestones in the tooltip", () => {
    renderPlan({
      milestones: [
        createMilestone({ id: "a", name: "Done", status: "completed" }),
        createMilestone({
          id: "b",
          name: "Old",
          startAt: "2026-09-12",
          status: "archived",
        }),
        createMilestone({
          id: "pending-1",
          name: "Saving",
          startAt: "2026-09-14",
        }),
      ],
    });

    expect(card(/Done/).title).toContain("Abgeschlossen");
    expect(card(/Old/).title).toContain("Archiviert");
    expect(card(/Saving/)).toBeDisabled();
  });

  it("draws dependency lines between milestones", () => {
    renderPlan({
      milestoneLinks: [
        createLink({ id: "l1", sourceId: "m1", targetId: "m2" }),
      ],
      milestones: ALL,
    });

    expect(
      document.querySelectorAll("svg path[stroke^='url(#plan-grad-']"),
    ).toHaveLength(1);
  });

  it("switches the view and resets it", async () => {
    const user = userEvent.setup();

    renderPlan({ milestones: ALL });
    await user.click(screen.getByRole("button", { name: "Monate" }));

    expect(screen.getByRole("button", { name: "Monate" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByText("KW 40")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Quartal" }));

    expect(screen.getAllByText(/^Q\d 2026$/).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Zurücksetzen" }));

    expect(screen.getByRole("button", { name: "Quartal" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("shows the icon, title and full content depending on the width", () => {
    renderPlan({
      milestones: [
        createMilestone({
          dueAt: "2026-09-18",
          id: "icon",
          name: "Icon",
          startAt: "2026-09-10",
        }),
        createMilestone({
          dueAt: "2026-09-22",
          id: "title",
          name: "Title",
          startAt: "2026-09-10",
          status: "archived",
        }),
        createMilestone({
          dueAt: "2026-10-15",
          id: "full",
          name: "Full",
          startAt: "2026-09-10",
        }),
      ],
    });

    expect(card(/Icon/).textContent).toBe("");
    expect(card(/Title/).textContent).toContain("Title");
    expect(card(/Title/).textContent).not.toContain("2026");
    expect(card(/Full/).textContent).toContain("10.09. – 15.10.2026");
  });

  it("hides the marker for today outside the window", async () => {
    const user = userEvent.setup();

    renderPlan({ milestones: ALL });
    expect(screen.getByText("Heute")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Spätere Zeiträume" }));
    await user.click(screen.getByRole("button", { name: "Spätere Zeiträume" }));

    expect(screen.queryByText("Heute")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Frühere Zeiträume" }));
    await user.click(screen.getByRole("button", { name: "Frühere Zeiträume" }));
    await user.click(screen.getByRole("button", { name: "Frühere Zeiträume" }));
    await user.click(screen.getByRole("button", { name: "Frühere Zeiträume" }));

    expect(screen.queryByText("Heute")).toBeNull();
  });

  it("moves the visible window earlier and later", async () => {
    const user = userEvent.setup();

    renderPlan({ milestones: ALL });
    expect(screen.getByText("KW 40")).toBeInTheDocument();

    for (let index = 0; index < 2; index += 1) {
      await user.click(
        screen.getByRole("button", { name: "Spätere Zeiträume" }),
      );
    }

    expect(screen.queryByText("KW 40")).toBeNull();

    for (let index = 0; index < 2; index += 1) {
      await user.click(
        screen.getByRole("button", { name: "Frühere Zeiträume" }),
      );
    }

    expect(screen.getByText("KW 40")).toBeInTheDocument();
  });

  it("offers adding only to writers", () => {
    renderPlan({ canWrite: false, milestones: ALL });

    expect(
      screen.queryByRole("button", { name: "Meilenstein hinzufügen" }),
    ).toBeNull();
  });

  it("does not open the editor for readers", async () => {
    const user = userEvent.setup();

    renderPlan({ canWrite: false, milestones: ALL });
    await user.click(card(/Kickoff/));

    expect(screen.queryByRole("complementary")).toBeNull();
  });
});

describe("PhaseMilestonePlan scrolling", () => {
  let removeLayout: () => void;

  afterEach(() => {
    removeLayout();
  });

  function viewport(): HTMLElement {
    return document.querySelector(".pages-thin-scrollbar") as HTMLElement;
  }

  function fades(): { start: boolean; end: boolean } {
    return {
      end:
        document
          .querySelector(".pages-scroll-fade-end")
          ?.classList.contains("opacity-100") ?? false,
      start:
        document
          .querySelector(".pages-scroll-fade-start")
          ?.classList.contains("opacity-100") ?? false,
    };
  }

  it("fills the viewport after rendering and parks near the left edge", () => {
    removeLayout = installLayout(1000, 5000);
    renderPlan({ milestones: ALL });

    expect(viewport().scrollLeft).toBeGreaterThan(0);
    expect(fades().start).toBe(true);
  });

  it("grows the window to the left when scrolling close to the start", () => {
    removeLayout = installLayout(1000, 5000);
    renderPlan({ milestones: ALL });

    const before = screen.getAllByText(/^KW \d+$/).length;

    viewport().scrollLeft = 10;
    fireEvent.scroll(viewport());

    expect(screen.getAllByText(/^KW \d+$/).length).toBeGreaterThan(before);
    expect(viewport().scrollLeft).toBeGreaterThan(10);
  });

  it("grows the window to the right when scrolling close to the end", () => {
    removeLayout = installLayout(1000, 5000);
    renderPlan({ milestones: ALL });

    const before = screen.getAllByText(/^KW \d+$/).length;

    viewport().scrollLeft = 4000;
    fireEvent.scroll(viewport());

    expect(screen.getAllByText(/^KW \d+$/).length).toBeGreaterThan(before);
  });

  it("keeps the window while scrolling in the middle and updates the fades", () => {
    removeLayout = installLayout(1000, 5000);
    renderPlan({ milestones: ALL });

    const before = screen.getAllByText(/^KW \d+$/).length;

    viewport().scrollLeft = 2000;
    fireEvent.scroll(viewport());

    expect(screen.getAllByText(/^KW \d+$/).length).toBe(before);
    expect(fades()).toEqual({ end: true, start: true });
  });

  it("ignores scrolling when the content does not overflow", () => {
    removeLayout = installLayout(1000, 1000);
    renderPlan({ milestones: ALL });

    const before = screen.getAllByText(/^KW \d+$/).length;

    expect(fades().start).toBe(true);

    viewport().scrollLeft = 0;
    fireEvent.scroll(viewport());

    expect(screen.getAllByText(/^KW \d+$/).length).toBe(before);
    expect(fades()).toEqual({ end: false, start: false });
  });

  it("widens the window to fill a large viewport", () => {
    removeLayout = installLayout(3000, 9000);
    renderPlan({ milestones: ALL });

    expect(screen.getAllByText(/^KW \d+$/).length).toBeGreaterThan(20);
  });

  it("keeps rendering when the window never needs to grow", () => {
    removeLayout = installLayout(0, 0);
    renderPlan({ milestones: ALL });

    expect(screen.getByText("KW 40")).toBeInTheDocument();
  });
});
