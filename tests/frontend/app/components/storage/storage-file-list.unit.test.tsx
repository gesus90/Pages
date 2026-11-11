import { fireEvent, render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";

import { StorageFileList } from "@/app/components/storage/storage-file-list";
import { createI18n } from "@/app/lib/i18n";

import type { StorageSelection } from "@/app/components/storage/use-storage-selection";
import type { StorageItem } from "@/definition/GoogleDriveStorage";

const i18n = createI18n("en");

const FOLDER: StorageItem = {
  id: "folder 1",
  isFolder: true,
  mimeType: "application/vnd.google-apps.folder",
  modifiedAt: "2026-03-04T10:30:00Z",
  name: "Projects",
  sizeBytes: null,
  webViewLink: null,
};
const FILE: StorageItem = {
  id: "file-1",
  isFolder: false,
  mimeType: "application/pdf",
  modifiedAt: null,
  name: "plan.pdf",
  sizeBytes: 4_200_000,
  webViewLink: "https://drive.example/file-1",
};
const LOCAL: StorageItem = {
  id: "file-2",
  isFolder: false,
  mimeType: "text/plain",
  modifiedAt: "not a date",
  name: "",
  sizeBytes: null,
  webViewLink: null,
};

function selectionOf(
  selected: readonly StorageItem[] = [],
  overrides: Partial<StorageSelection> = {},
): StorageSelection {
  const ids = new Set(selected.map((item) => item.id));

  return {
    clear: vi.fn(),
    click: vi.fn(),
    isMultiSelect: false,
    isSelected: (ref) => ids.has(ref),
    items: selected,
    prepareContextMenu: vi.fn(),
    selectAll: vi.fn(),
    toggle: vi.fn(),
    toggleMultiSelect: vi.fn(),
    ...overrides,
  };
}

function renderList(
  props: Partial<React.ComponentProps<typeof StorageFileList>> = {},
): void {
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <StorageFileList items={[FOLDER, FILE, LOCAL]} {...props} />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

function checkboxOf(name: string): HTMLInputElement {
  const box = screen.getByRole("checkbox", { name });

  if (!(box instanceof HTMLInputElement)) throw new Error("no checkbox");

  return box;
}

function rowOf(name: string | RegExp): HTMLElement {
  const row = screen.getByText(name).closest("tr");

  if (row === null) throw new Error("no row");

  return row;
}

it("shows the name, modified and size heads without actions column", () => {
  renderList();

  expect(
    screen.getAllByRole("columnheader").map((head) => head.textContent),
  ).toEqual(["Name", "Modified", "Size"]);
});

it("links folders to their address and files to Google Drive", () => {
  renderList();

  expect(
    screen.getByRole("link", { name: /Projects/ }).getAttribute("href"),
  ).toBe("/storage?folder=folder%201");
  const fileLink = screen.getByRole("link", { name: /plan\.pdf/ });
  expect(fileLink.getAttribute("href")).toBe("https://drive.example/file-1");
  expect(fileLink.getAttribute("target")).toBe("_blank");
  expect(fileLink.getAttribute("rel")).toBe("noopener noreferrer");
  expect(fileLink.getAttribute("referrerpolicy")).toBe("no-referrer");
  expect(fileLink.getAttribute("title")).toBe("Open in Google Drive");
});

it("shows a file without a Drive page as plain text and names the unnamed", () => {
  renderList();

  const row = rowOf("(untitled)");

  expect(within(row).queryByRole("link")).toBeNull();
});

it("formats size, folder label and missing values", () => {
  renderList();

  expect(within(rowOf("Projects")).getByText("Folder")).toBeTruthy();
  expect(within(rowOf("plan.pdf")).getByText("4.2 MB")).toBeTruthy();
  // plan.pdf has no modified time, (untitled) no size and an unreadable time.
  expect(within(rowOf("plan.pdf")).getAllByText("—")).toHaveLength(1);
  expect(within(rowOf("(untitled)")).getAllByText("—")).toHaveLength(1);
  expect(within(rowOf("Projects")).getByText(/2026/)).toBeTruthy();
});

it("renders the action column with the menu of each entry", () => {
  renderList({
    renderActions: (item) => <button type="button">Menu {item.name}</button>,
  });

  expect(screen.getByText("Actions")).toBeTruthy();
  expect(
    within(rowOf("Projects")).getByRole("button", { name: "Menu Projects" }),
  ).toBeTruthy();
  expect(screen.getAllByRole("columnheader")).toHaveLength(4);
});

it("makes rows inert without a selection", () => {
  renderList({ onOpenMenu: vi.fn() });

  const row = rowOf("plan.pdf");

  expect(row.hasAttribute("tabindex")).toBe(false);
  expect(fireEvent.contextMenu(row)).toBe(true);
  expect(screen.queryByRole("checkbox")).toBeNull();
});

it("selects a row by click and adds with Ctrl or Cmd", () => {
  const selection = selectionOf();
  renderList({ selection });

  fireEvent.click(rowOf("plan.pdf"));
  fireEvent.click(rowOf("plan.pdf"), { ctrlKey: true });
  fireEvent.click(rowOf("Projects"), { metaKey: true });

  expect(selection.click).toHaveBeenNthCalledWith(1, "file-1", false);
  expect(selection.click).toHaveBeenNthCalledWith(2, "file-1", true);
  expect(selection.click).toHaveBeenNthCalledWith(3, "folder 1", true);
});

it("does not select a row when a link or button inside it is clicked", () => {
  const selection = selectionOf();
  renderList({
    renderActions: () => <button type="button">Row menu</button>,
    selection,
  });

  fireEvent.click(screen.getByRole("link", { name: /plan\.pdf/ }));
  fireEvent.click(within(rowOf("plan.pdf")).getByRole("button"));

  expect(selection.click).not.toHaveBeenCalled();
});

it("marks selected rows and announces the selection outside the multi-select mode", () => {
  renderList({ selection: selectionOf([FILE]) });

  const row = rowOf("plan.pdf");

  expect(row.getAttribute("data-selected")).toBe("true");
  expect(row.getAttribute("tabindex")).toBe("0");
  expect(within(row).getByText("(selected)")).toBeTruthy();
  expect(rowOf("Projects").hasAttribute("data-selected")).toBe(false);
  expect(within(rowOf("Projects")).queryByText("(selected)")).toBeNull();
});

it("selects with the space key on the row itself only", () => {
  const selection = selectionOf();
  renderList({
    renderActions: () => <button type="button">Row menu</button>,
    selection,
  });
  const row = rowOf("plan.pdf");

  fireEvent.keyDown(row, { key: "Enter" });
  expect(selection.click).not.toHaveBeenCalled();

  fireEvent.keyDown(within(row).getByRole("button"), { key: " " });
  expect(selection.click).not.toHaveBeenCalled();

  fireEvent.keyDown(row, { key: " " });
  fireEvent.keyDown(row, { ctrlKey: true, key: " " });
  expect(selection.click).toHaveBeenNthCalledWith(1, "file-1", false);
  expect(selection.click).toHaveBeenNthCalledWith(2, "file-1", true);
});

it("ignores the space key without a selection", () => {
  renderList();

  expect(fireEvent.keyDown(rowOf("plan.pdf"), { key: " " })).toBe(true);
});

it("opens the own menu at the pointer after a right click", () => {
  const selection = selectionOf();
  const onOpenMenu = vi.fn();
  renderList({ onOpenMenu, selection });

  const allowed = fireEvent.contextMenu(rowOf("plan.pdf"), {
    clientX: 40,
    clientY: 60,
  });

  expect(allowed).toBe(false);
  expect(selection.prepareContextMenu).toHaveBeenCalledWith("file-1");
  expect(onOpenMenu).toHaveBeenCalledWith({ x: 40, y: 60 });
});

it("opens the menu at the corner of the row when the keyboard asked for it", () => {
  const onOpenMenu = vi.fn();
  renderList({ onOpenMenu, selection: selectionOf() });
  const row = rowOf("plan.pdf");
  vi.spyOn(row, "getBoundingClientRect").mockReturnValue(
    new DOMRect(10, 100, 300, 40),
  );

  fireEvent.contextMenu(row, { clientX: 0, clientY: 0 });

  expect(onOpenMenu).toHaveBeenCalledWith({ x: 34, y: 120 });
});

it("keeps the browser menu when the list has no menu handler", () => {
  const selection = selectionOf();
  renderList({ selection });

  expect(fireEvent.contextMenu(rowOf("plan.pdf"))).toBe(true);
  expect(selection.prepareContextMenu).not.toHaveBeenCalled();
});

it("shows checkboxes in the multi-select mode and toggles one row", () => {
  const selection = selectionOf([FILE], { isMultiSelect: true });
  renderList({ selection });

  const box = checkboxOf("Select plan.pdf");
  expect(box.checked).toBe(true);
  expect(checkboxOf("Select Projects").checked).toBe(false);
  expect(
    screen.getByRole("checkbox", { name: "Select (untitled)" }),
  ).toBeTruthy();
  expect(within(rowOf("plan.pdf")).queryByText("(selected)")).toBeNull();

  fireEvent.click(box);

  expect(selection.toggle).toHaveBeenCalledWith("file-1");
  expect(selection.click).not.toHaveBeenCalled();
});

it("selects all entries from the head checkbox and clears when all are selected", () => {
  const some = selectionOf([FILE], { isMultiSelect: true });
  const { unmount } = render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <StorageFileList items={[FOLDER, FILE, LOCAL]} selection={some} />
      </MemoryRouter>
    </I18nextProvider>,
  );

  const head = checkboxOf("Select all");
  expect(head.checked).toBe(false);
  fireEvent.click(head);
  expect(some.selectAll).toHaveBeenCalledTimes(1);
  expect(some.clear).not.toHaveBeenCalled();
  unmount();

  const all = selectionOf([FOLDER, FILE, LOCAL], { isMultiSelect: true });
  renderList({ selection: all });
  const checked = checkboxOf("Select all");
  expect(checked.checked).toBe(true);
  fireEvent.click(checked);
  expect(all.clear).toHaveBeenCalledTimes(1);
});

it("does not check the head checkbox for an empty list", () => {
  renderList({
    items: [],
    selection: selectionOf([], { isMultiSelect: true }),
  });

  const head = checkboxOf("Select all");

  expect(head.checked).toBe(false);
});
