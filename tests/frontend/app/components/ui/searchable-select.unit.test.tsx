import { fireEvent, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { renderSelect } from "./searchable-select-fixture";

it("opens a labelled listbox, focuses search and chooses an option", () => {
  const { changed } = renderSelect();
  const trigger = screen.getByRole("combobox", { name: "Model" });
  expect(trigger.textContent).toContain("Choose a model");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(trigger);
  expect(screen.getByRole("listbox", { name: "Model" })).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole("searchbox"));
  fireEvent.click(screen.getByRole("option", { name: "Beta" }));
  expect(changed).toHaveBeenCalledExactlyOnceWith("beta");
  expect(trigger.textContent).toContain("Beta");
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it("matches every search word across labels and keywords, ignoring case", () => {
  renderSelect();
  fireEvent.click(screen.getByRole("combobox"));
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: " PROVIDER first " },
  });
  expect(
    screen.getAllByRole("option").map((option) => option.textContent),
  ).toEqual(["Alpha"]);
  expect(screen.getByRole("status").textContent).toBe("1 of 4");
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "missing" },
  });
  expect(screen.queryByRole("option")).toBeNull();
  expect(screen.getByText("No matching models")).toBeTruthy();
});

it("combines prefilters and toggles a filter off again", () => {
  renderSelect();
  fireEvent.click(screen.getByRole("combobox"));
  fireEvent.click(screen.getByRole("button", { name: "Free" }));
  expect(screen.getAllByRole("option")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Fast" }));
  expect(screen.getAllByRole("option")).toHaveLength(1);
  expect(
    screen.getByRole("button", { name: "Fast" }).getAttribute("aria-pressed"),
  ).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Free" }));
  expect(
    screen.getAllByRole("option").map((option) => option.textContent),
  ).toEqual(["Alpha", "Gamma"]);
});

it("shows an unavailable saved value without inventing an option", () => {
  renderSelect({ value: "removed-model" });
  expect(screen.getByRole("combobox").textContent).toContain(
    "removed-model (unavailable)",
  );
  fireEvent.click(screen.getByRole("combobox"));
  expect(screen.queryByRole("option", { selected: true })).toBeNull();
});

it("keeps a disabled select closed", () => {
  const { changed } = renderSelect({ disabled: true });
  const trigger = screen.getByRole("combobox");
  expect(trigger).toHaveProperty("disabled", true);
  fireEvent.click(trigger);
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(changed).not.toHaveBeenCalled();
});

it("ignores a disabled option and keeps the panel open", () => {
  const { changed } = renderSelect();
  fireEvent.click(screen.getByRole("combobox"));
  const option = screen.getByRole("option", { name: "Disabled choice" });
  expect(option.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(option);
  expect(changed).not.toHaveBeenCalled();
  expect(screen.getByRole("listbox")).toBeTruthy();
});
