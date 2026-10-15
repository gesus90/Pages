import { fireEvent, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { renderSelect } from "./searchable-select-fixture";

it.each(["ArrowDown", "ArrowUp"])(
  "opens with %s and skips disabled options while wrapping",
  (key) => {
    const { changed } = renderSelect({ value: "alpha" });
    fireEvent.keyDown(screen.getByRole("combobox"), { key });
    const search = screen.getByRole("searchbox");
    fireEvent.keyDown(search, { key: "ArrowUp" });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(changed).toHaveBeenCalledExactlyOnceWith("beta");
    expect(screen.queryByRole("listbox")).toBeNull();
  },
);

it("closes on Escape and restores trigger focus without changing selection", () => {
  const { changed } = renderSelect();
  const trigger = screen.getByRole("combobox");
  fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" });
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(changed).not.toHaveBeenCalled();
});

it("keeps internal focus changes open and closes when focus leaves the select", () => {
  renderSelect();
  const trigger = screen.getByRole("combobox");
  fireEvent.click(trigger);
  const search = screen.getByRole("searchbox");
  fireEvent.blur(search, { relatedTarget: trigger });
  expect(screen.getByRole("listbox")).toBeTruthy();
  fireEvent.blur(search, { relatedTarget: document.body });
  expect(screen.queryByRole("listbox")).toBeNull();
});

it("ignores Enter and arrow keys when no enabled option is available", () => {
  const { changed } = renderSelect({
    options: [{ value: "blocked", label: "Blocked", disabled: true }],
  });
  fireEvent.click(screen.getByRole("combobox"));
  const search = screen.getByRole("searchbox");
  expect(search.getAttribute("aria-activedescendant")).toBeNull();
  fireEvent.keyDown(search, { key: "ArrowDown" });
  fireEvent.keyDown(search, { key: "Enter" });
  expect(changed).not.toHaveBeenCalled();
  expect(screen.getByRole("listbox")).toBeTruthy();
});

it("clears the search when reopened and marks the selected option", () => {
  renderSelect({ value: "beta" });
  const trigger = screen.getByRole("combobox");
  fireEvent.click(trigger);
  expect(screen.getByRole("option", { selected: true }).textContent).toBe(
    "Beta",
  );
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "missing" },
  });
  fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" });
  fireEvent.click(trigger);
  expect(screen.getByRole("searchbox")).toHaveProperty("value", "");
  expect(screen.getAllByRole("option")).toHaveLength(4);
});
