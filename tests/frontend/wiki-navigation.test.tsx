// @vitest-environment jsdom
import {
  createEvent,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WikiNavigation } from "@/app/components/wiki/wiki-navigation";

import { renderInWiki } from "../helpers/wiki-render";

import type {
  WikiNavigation as WikiNavigationData,
  WikiTreeNode,
} from "@/definition/Wiki";

function node(id: string, overrides: Partial<WikiTreeNode> = {}): WikiTreeNode {
  return {
    currentUntil: null,
    icon: null,
    id,
    parentId: null,
    position: 1,
    projectId: null,
    scope: "instance",
    title: id,
    ...overrides,
  };
}

const NAVIGATION: WikiNavigationData = {
  canCreate: true,
  expandedIds: [],
  favoriteIds: ["a", "gone"],
  nodes: [
    node("a", { icon: "📘", title: "Alpha" }),
    node("a1", { parentId: "a", title: "Alpha child" }),
    node("a2", { parentId: "a", title: "Alpha second" }),
    node("a3", { parentId: "a", title: "Alpha third" }),
    node("deep", { parentId: "a1", title: "Deep page" }),
    node("p", { projectId: "p1", scope: "project", title: "Project page" }),
    node("s", { scope: "private", title: "Secret" }),
    node("old", { currentUntil: "2020-01-01", title: "Old page" }),
  ],
  projects: [
    { id: "p1", name: "Project One" },
    { id: "p2", name: "Project Two" },
  ],
  recent: [{ icon: null, id: "a1", title: "Alpha child" }],
};

function renderNav(
  navigation = NAVIGATION,
  path = "/wiki",
  extra: Parameters<typeof renderInWiki>[1] = {},
) {
  const onSearch = vi.fn();
  const onNavigate = vi.fn();
  const rendered = renderInWiki(
    <WikiNavigation
      navigation={navigation}
      today="2026-10-07"
      templates={[]}
      onNavigate={onNavigate}
      onSearch={onSearch}
    />,
    { path, ...extra },
  );

  return { ...rendered, onNavigate, onSearch };
}

function dataTransfer() {
  return { effectAllowed: "", setData: vi.fn() };
}

function mockRow(row: HTMLElement, top = 0, height = 100): void {
  row.getBoundingClientRect = () =>
    ({
      bottom: top + height,
      height,
      left: 0,
      right: 100,
      top,
      width: 100,
      x: 0,
      y: top,
    }) as DOMRect;
}

/** Fires a drag event whose pointer is at the given height. */
function dragAt(
  element: HTMLElement,
  type: "dragOver" | "drop",
  clientY: number,
): void {
  const event = createEvent[type](element);

  Object.defineProperty(event, "clientY", { value: clientY });
  fireEvent(element, event);
}

function rowOf(id: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(`[data-wiki-node="${id}"]`);

  if (!row) {
    throw new Error(`No row ${id}`);
  }

  return row;
}

describe("WikiNavigation", () => {
  it("shows the areas, favorites, recent pages and the pages of projects with pages", async () => {
    renderNav();

    expect(
      await screen.findByRole("navigation", { name: "Wiki navigation" }),
    ).toBeVisible();
    expect(screen.getByRole("region", { name: "Favorites" })).toHaveTextContent(
      "Alpha",
    );
    expect(
      screen.getByRole("region", { name: "Recently opened" }),
    ).toHaveTextContent("Alpha child");
    expect(screen.getByRole("region", { name: "Private" })).toHaveTextContent(
      "Secret",
    );
    expect(screen.getByRole("region", { name: "General" })).toHaveTextContent(
      "Alpha",
    );
    expect(
      screen.getByRole("region", { name: "Project One" }),
    ).toHaveTextContent("Project page");
    expect(screen.queryByRole("region", { name: "Project Two" })).toBeNull();
    expect(screen.getByRole("link", { name: "Trash" })).toHaveAttribute(
      "href",
      "/wiki/trash",
    );
    expect(screen.getByLabelText("No longer current")).toBeInTheDocument();
  });

  it("calls back for search and links", async () => {
    const { onNavigate, onSearch } = renderNav();

    await userEvent.click(
      await screen.findByRole("button", { name: "Search" }),
    );
    await userEvent.click(screen.getByRole("link", { name: "Overview" }));

    expect(onSearch).toHaveBeenCalled();
    expect(onNavigate).toHaveBeenCalled();
  });

  it("hides the new page button without the right to write", async () => {
    renderNav({ ...NAVIGATION, canCreate: false });

    await screen.findByRole("navigation");

    expect(screen.queryByRole("button", { name: "New page" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Add a subpage to “Alpha”" }),
    ).toBeNull();
  });

  it("creates a subpage from the plus of a tree entry", async () => {
    const { layoutSubmissions, router } = renderNav();

    await userEvent.click(
      await screen.findByRole("button", { name: "Add a subpage to “Alpha”" }),
    );

    const dialog = await screen.findByRole("dialog", { name: "New page" });

    await userEvent.type(within(dialog).getByLabelText("Title"), "Child");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Create page" }),
    );
    await waitFor(() =>
      expect(layoutSubmissions[0]).toMatchObject({
        intent: "create-page",
        parentId: "a",
        title: "Child",
      }),
    );

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await userEvent.click(
      screen.getByRole("button", { name: "Add a subpage to “Alpha”" }),
    );
    expect(await screen.findByRole("dialog")).toBeVisible();
    await router.navigate("/wiki/a1");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("shows an empty note without pages", async () => {
    renderNav({ ...NAVIGATION, favoriteIds: [], nodes: [], recent: [] });

    expect(await screen.findByText("No pages yet.")).toBeVisible();
  });

  it("opens and closes branches and stores the choice", async () => {
    const { layoutSubmissions } = renderNav();

    await userEvent.click(
      await screen.findByRole("button", { name: "Expand Alpha" }),
    );

    expect(screen.getByRole("link", { name: "Alpha second" })).toBeVisible();
    await waitFor(() =>
      expect(layoutSubmissions).toContainEqual({
        expanded: "1",
        intent: "set-expanded",
        pageId: "a",
      }),
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Collapse Alpha" }),
    );

    expect(screen.queryByRole("link", { name: "Alpha second" })).toBeNull();
    await waitFor(() =>
      expect(layoutSubmissions).toContainEqual({
        expanded: "0",
        intent: "set-expanded",
        pageId: "a",
      }),
    );
  });

  it("opens the branches above the open page and starts with the stored ones", async () => {
    renderNav({ ...NAVIGATION, expandedIds: ["a"] }, "/wiki/deep");

    expect(
      await screen.findByRole("link", { name: "Deep page" }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Alpha second" })).toBeVisible();
  });

  it("moves a page dropped into another page of the same area", async () => {
    const { layoutSubmissions } = renderNav({
      ...NAVIGATION,
      expandedIds: ["a"],
    });

    await screen.findByRole("navigation");

    const transfer = dataTransfer();

    fireEvent.dragStart(rowOf("a2"), { dataTransfer: transfer });
    expect(transfer.effectAllowed).toBe("move");
    fireEvent.dragOver(rowOf("a1"));
    fireEvent.drop(rowOf("a1"));

    await waitFor(() =>
      expect(layoutSubmissions).toContainEqual({
        beforeId: "",
        intent: "move-page",
        pageId: "a2",
        parentId: "a1",
        projectId: "",
        scope: "instance",
      }),
    );
  });

  it("places a page before or after the row it is dropped on", async () => {
    const { layoutSubmissions } = renderNav({
      ...NAVIGATION,
      expandedIds: ["a"],
    });

    await screen.findByRole("navigation");
    mockRow(rowOf("a1"));
    fireEvent.dragStart(rowOf("a2"), { dataTransfer: dataTransfer() });
    dragAt(rowOf("a1"), "dragOver", 5);
    dragAt(rowOf("a1"), "drop", 5);
    fireEvent.dragStart(rowOf("a2"), { dataTransfer: dataTransfer() });
    dragAt(rowOf("a1"), "dragOver", 95);
    dragAt(rowOf("a1"), "drop", 95);

    await waitFor(() => expect(layoutSubmissions).toHaveLength(2));
    expect(layoutSubmissions[0]).toMatchObject({
      beforeId: "a1",
      parentId: "a",
    });
    expect(layoutSubmissions[1]).toMatchObject({ beforeId: "", parentId: "a" });
  });

  it("places a page before the sibling that follows the row it is dropped after", async () => {
    const { layoutSubmissions } = renderNav({
      ...NAVIGATION,
      expandedIds: ["a"],
    });

    await screen.findByRole("navigation");
    mockRow(rowOf("a1"));
    fireEvent.dragStart(rowOf("a3"), { dataTransfer: dataTransfer() });
    dragAt(rowOf("a1"), "dragOver", 95);
    dragAt(rowOf("a1"), "drop", 95);

    await waitFor(() => expect(layoutSubmissions).toHaveLength(1));
    expect(layoutSubmissions[0]).toMatchObject({
      beforeId: "a2",
      pageId: "a3",
    });
  });

  it("appends after the last sibling and skips the dragged page as next sibling", async () => {
    const { layoutSubmissions } = renderNav({
      ...NAVIGATION,
      expandedIds: ["a"],
    });

    await screen.findByRole("navigation");
    mockRow(rowOf("a1"));
    mockRow(rowOf("a3"));
    fireEvent.dragStart(rowOf("a2"), { dataTransfer: dataTransfer() });
    dragAt(rowOf("a1"), "dragOver", 95);
    dragAt(rowOf("a1"), "drop", 95);
    fireEvent.dragStart(rowOf("a1"), { dataTransfer: dataTransfer() });
    dragAt(rowOf("a3"), "dragOver", 95);
    dragAt(rowOf("a3"), "drop", 95);

    await waitFor(() => expect(layoutSubmissions).toHaveLength(2));
    expect(layoutSubmissions[0]).toMatchObject({ beforeId: "" });
    expect(layoutSubmissions[1]).toMatchObject({ beforeId: "" });
  });

  it("ignores drops onto the page itself or its subpages and without a drag", async () => {
    const { layoutSubmissions } = renderNav({
      ...NAVIGATION,
      expandedIds: ["a", "a1"],
    });

    await screen.findByRole("navigation");
    fireEvent.dragOver(rowOf("a1"));
    fireEvent.drop(rowOf("a1"));
    fireEvent.dragStart(rowOf("a"), { dataTransfer: dataTransfer() });
    fireEvent.dragOver(rowOf("deep"));
    fireEvent.drop(rowOf("deep"));
    fireEvent.dragEnd(rowOf("a"));
    fireEvent.drop(rowOf("a1"));

    expect(layoutSubmissions).toEqual([]);
  });

  it("asks first when a drop changes who sees the page", async () => {
    const { layoutSubmissions } = renderNav(
      { ...NAVIGATION, expandedIds: ["a"] },
      "/wiki",
      { layoutAnswers: { "preview-move": { change: "wider", ok: true } } },
    );

    await screen.findByRole("navigation");
    fireEvent.dragStart(rowOf("s"), { dataTransfer: dataTransfer() });
    fireEvent.dragOver(rowOf("a1"));
    fireEvent.drop(rowOf("a1"));

    const dialog = await screen.findByRole("dialog", { name: "Move page" });

    expect(
      await within(dialog).findByText("Afterwards more people see this page."),
    ).toBeVisible();
    expect(
      layoutSubmissions.some((entry) => entry.intent === "move-page"),
    ).toBe(false);

    await userEvent.click(within(dialog).getByRole("button", { name: "Move" }));
    await waitFor(() =>
      expect(
        layoutSubmissions.some((entry) => entry.intent === "move-page"),
      ).toBe(true),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("moves a page to the top of an area dropped on its heading", async () => {
    const { layoutSubmissions } = renderNav(
      { ...NAVIGATION, expandedIds: ["a"] },
      "/wiki",
      { layoutAnswers: { "preview-move": { change: "narrower", ok: true } } },
    );

    await screen.findByRole("navigation");
    fireEvent.dragStart(rowOf("a2"), { dataTransfer: dataTransfer() });

    const privateArea = screen.getByRole("region", { name: "Private" });

    fireEvent.dragOver(privateArea);
    fireEvent.drop(privateArea);

    expect(
      await screen.findByText("Afterwards fewer people see this page."),
    ).toBeVisible();
    expect(
      layoutSubmissions.some((entry) => entry.intent === "move-page"),
    ).toBe(false);
  });

  it("accepts an area drop onto the area it is already in", async () => {
    const { layoutSubmissions } = renderNav({
      ...NAVIGATION,
      expandedIds: ["a"],
    });

    await screen.findByRole("navigation");
    fireEvent.dragOver(screen.getByRole("region", { name: "General" }));
    fireEvent.dragStart(rowOf("a2"), { dataTransfer: dataTransfer() });
    fireEvent.dragOver(screen.getByRole("region", { name: "General" }));
    fireEvent.drop(screen.getByRole("region", { name: "General" }));
    fireEvent.drop(screen.getByRole("region", { name: "General" }));

    await waitFor(() => expect(layoutSubmissions).toHaveLength(1));
    expect(layoutSubmissions[0]).toMatchObject({
      intent: "move-page",
      pageId: "a2",
      parentId: "",
    });
  });
});
