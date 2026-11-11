import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GPT,
  HAIKU,
  SONNET,
  activeRowName,
  groupRow,
  open,
  pickerElement,
  press,
  renderPicker,
  search,
  trigger,
} from "./model-picker-fixture";
import { pageModel } from "../plans/plan-model-fixture";

const scrollTo = vi.fn();

beforeEach(() => {
  scrollTo.mockClear();
  Element.prototype.scrollTo = scrollTo;
});
afterEach(() => {
  Reflect.deleteProperty(Element.prototype, "scrollTo");
  document.documentElement.removeAttribute("style");
  vi.restoreAllMocks();
});

describe("opening and closing", () => {
  it("opens with the saved model's tool expanded and the saved model highlighted", () => {
    renderPicker();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");

    open();

    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(search());
    expect(groupRow(/^Claude Code/u).getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(groupRow(/^Codex/u).getAttribute("aria-expanded")).toBe("false");
    expect(
      screen
        .getByRole("treeitem", { name: "Sonnet" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(activeRowName()).toBe("Sonnet");
    expect(trigger().getAttribute("aria-controls")).toBe(
      screen.getByRole("tree").id,
    );
  });

  it("closes when the trigger is clicked again", () => {
    renderPicker();
    open();

    open();

    expect(screen.queryByRole("tree")).toBeNull();
    expect(trigger().getAttribute("aria-controls")).toBeNull();
  });

  it("closes on Escape and returns the focus to the trigger", () => {
    renderPicker();
    open();

    fireEvent.keyDown(search(), { key: "Escape" });

    expect(screen.queryByRole("tree")).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("ignores other keys on the window while open", () => {
    renderPicker();
    open();

    fireEvent.keyDown(window, { key: "a" });

    expect(screen.getByRole("tree")).toBeTruthy();
  });

  it("opens with Arrow Down and Arrow Up on the trigger but not with other keys", () => {
    renderPicker();

    expect(fireEvent.keyDown(trigger(), { key: "a" })).toBe(true);
    expect(screen.queryByRole("tree")).toBeNull();

    expect(fireEvent.keyDown(trigger(), { key: "ArrowDown" })).toBe(false);
    expect(screen.getByRole("tree")).toBeTruthy();
  });

  it("opens from the closed trigger with Arrow Up", () => {
    renderPicker();

    expect(fireEvent.keyDown(trigger(), { key: "ArrowUp" })).toBe(false);
    expect(screen.getByRole("tree")).toBeTruthy();
    expect(document.activeElement).toBe(search());
  });

  it("leaves arrow keys on an open trigger to the browser", () => {
    renderPicker();
    open();

    expect(fireEvent.keyDown(trigger(), { key: "ArrowUp" })).toBe(true);
    expect(screen.getByRole("tree")).toBeTruthy();
  });

  it("closes when the picker becomes disabled", () => {
    const view = renderPicker();
    open();

    view.rerender(pickerElement({ disabled: true }));

    expect(screen.queryByRole("tree")).toBeNull();
    expect(trigger().hasAttribute("disabled")).toBe(true);
  });

  it("opens without a saved model with every tool closed and the first row highlighted", () => {
    renderPicker({ value: "", placeholder: "Choose a model" });
    expect(screen.getByText("Choose a model")).toBeTruthy();

    open();

    expect(groupRow(/^Claude Code/u).getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(activeRowName()).toBe("Claude Code, Claude subscription, 2 models");
  });

  it("opens the saved model's tool again when the person had closed it", () => {
    renderPicker();
    open();
    press("ArrowLeft");
    press("ArrowLeft");
    expect(groupRow(/^Claude Code/u).getAttribute("aria-expanded")).toBe(
      "false",
    );
    fireEvent.keyDown(search(), { key: "Escape" });

    open();

    expect(groupRow(/^Claude Code/u).getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(activeRowName()).toBe("Sonnet");
  });

  it("starts a reopened panel with an empty search", () => {
    renderPicker();
    open();
    fireEvent.change(search(), { target: { value: "gpt" } });
    fireEvent.keyDown(search(), { key: "Escape" });

    open();

    expect(search().value).toBe("");
  });
});

describe("trigger text", () => {
  it("names a saved model that no longer exists", () => {
    renderPicker({ value: "gone", savedModel: "vendor/gone" });

    expect(trigger().textContent).toContain("vendor/gone ·");
    expect(trigger().textContent).toContain(
      "Model or connection unavailable/not shared",
    );
  });

  it("names a missing model without a saved name", () => {
    renderPicker({ value: "gone" });

    expect(trigger().textContent).toBe(
      "Model or connection unavailable/not shared",
    );
  });

  it("shows the free badge of a chosen free model", () => {
    renderPicker({ value: "gpt" });

    expect(trigger().textContent).toContain("GPT");
    expect(trigger().textContent).toContain("Free");
  });
});

describe("search", () => {
  it("opens every matching tool, hides the rest and resets the list scroll", () => {
    renderPicker();
    open();

    fireEvent.change(search(), { target: { value: "gpt" } });

    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
    expect(
      screen.queryByRole("treeitem", { name: /^Claude Code/u }),
    ).toBeNull();
    expect(groupRow(/^Codex/u).getAttribute("aria-expanded")).toBe("true");
    expect(activeRowName()).toBe("GPT, Free");
  });

  it("chooses the first match with Enter and closes", () => {
    const onChange = vi.fn();
    renderPicker({ onChange });
    open();
    fireEvent.change(search(), { target: { value: "gpt" } });

    const wasNotPrevented = press("Enter");

    expect(wasNotPrevented).toBe(false);
    expect(onChange).toHaveBeenCalledExactlyOnceWith("gpt");
    expect(screen.queryByRole("tree")).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("says that nothing matches and quotes the trimmed query", () => {
    renderPicker();
    open();

    fireEvent.change(search(), { target: { value: "  zzz  " } });

    expect(screen.getByText("No model matches “zzz”.")).toBeTruthy();
    expect(press("ArrowDown")).toBe(true);
    expect(press("Enter")).toBe(false);
  });

  it("restores the person's own open tools when the search is cleared", () => {
    renderPicker();
    open();
    fireEvent.change(search(), { target: { value: "gpt" } });

    fireEvent.change(search(), { target: { value: "" } });

    expect(groupRow(/^Claude Code/u).getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(groupRow(/^Codex/u).getAttribute("aria-expanded")).toBe("false");
  });

  it("closes a tool inside a search without touching the own choice", () => {
    renderPicker();
    open();
    fireEvent.change(search(), { target: { value: "gpt" } });

    fireEvent.click(within(groupRow(/^Codex/u)).getByText("Codex"));
    expect(groupRow(/^Codex/u).getAttribute("aria-expanded")).toBe("false");

    fireEvent.change(search(), { target: { value: "" } });
    expect(groupRow(/^Claude Code/u).getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(groupRow(/^Codex/u).getAttribute("aria-expanded")).toBe("false");
  });
});

describe("keyboard navigation", () => {
  it("moves over headers and models and wraps at both ends", () => {
    renderPicker();
    open();

    expect(press("ArrowDown")).toBe(false);
    expect(activeRowName()).toBe("Codex, ChatGPT account, 1 model");
    press("ArrowDown");
    expect(activeRowName()).toBe("Claude Code, Claude subscription, 2 models");
    press("ArrowUp");
    expect(activeRowName()).toBe("Codex, ChatGPT account, 1 model");
    press("ArrowUp");
    expect(activeRowName()).toBe("Sonnet");
  });

  it("ignores keys it does not own", () => {
    renderPicker();
    open();

    expect(press("a")).toBe(true);
    expect(activeRowName()).toBe("Sonnet");
  });

  it("opens and closes a tool with Enter on its header", () => {
    renderPicker();
    open();
    fireEvent.mouseEnter(within(groupRow(/^Codex/u)).getByText("Codex"));
    expect(activeRowName()).toBe("Codex, ChatGPT account, 1 model");

    press("Enter");
    expect(groupRow(/^Codex/u).getAttribute("aria-expanded")).toBe("true");
    expect(activeRowName()).toBe("Codex, ChatGPT account, 1 model");

    press("Enter");
    expect(groupRow(/^Codex/u).getAttribute("aria-expanded")).toBe("false");
  });

  it("opens a closed tool with Arrow Right, then steps into it", () => {
    renderPicker();
    open();
    press("ArrowDown");

    expect(press("ArrowRight")).toBe(false);
    expect(groupRow(/^Codex/u).getAttribute("aria-expanded")).toBe("true");

    press("ArrowRight");
    expect(activeRowName()).toBe("GPT, Free");
  });

  it("closes an open tool with Arrow Left and leaves a model for its tool", () => {
    renderPicker();
    open();

    expect(press("ArrowLeft")).toBe(false);
    expect(activeRowName()).toBe("Claude Code, Claude subscription, 2 models");

    press("ArrowLeft");
    expect(groupRow(/^Claude Code/u).getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("does nothing for Arrow Right on a model or Arrow Left on a closed tool", () => {
    renderPicker();
    open();

    expect(press("ArrowRight")).toBe(true);
    expect(activeRowName()).toBe("Sonnet");

    press("ArrowDown");
    press("ArrowLeft");
    expect(groupRow(/^Codex/u).getAttribute("aria-expanded")).toBe("false");
    expect(activeRowName()).toBe("Codex, ChatGPT account, 1 model");
  });

  it("does not step into a tool whose first row is no model", () => {
    renderPicker({ models: [SONNET] });
    open();
    fireEvent.keyDown(search(), { key: "ArrowLeft" });
    fireEvent.keyDown(search(), { key: "ArrowLeft" });
    fireEvent.keyDown(search(), { key: "ArrowLeft" });

    expect(groupRow(/^Claude Code/u).getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(press("ArrowRight")).toBe(false);
    expect(press("ArrowRight")).toBe(false);
    expect(activeRowName()).toBe("Sonnet");
  });

  it("keeps Arrow Left and Right for the caret while the search holds text", () => {
    renderPicker();
    open();
    fireEvent.change(search(), { target: { value: "s" } });

    expect(press("ArrowLeft")).toBe(true);
    expect(press("ArrowRight")).toBe(true);
  });

  it("does nothing for tree keys when no row is listed", () => {
    renderPicker({ models: [] });
    open();

    expect(press("ArrowRight")).toBe(true);
    expect(press("ArrowDown")).toBe(true);
    expect(press("Enter")).toBe(false);
  });
});

describe("choosing", () => {
  it("chooses a model by click and reports its full selection key", () => {
    const onChange = vi.fn();
    renderPicker({ onChange });
    open();
    fireEvent.click(screen.getByRole("treeitem", { name: "Sonnet" }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith("sonnet");
    expect(screen.queryByRole("tree")).toBeNull();
  });

  it("lists a refused model with its reason but never chooses it", () => {
    const onChange = vi.fn();
    renderPicker({ onChange });
    open();
    const row = screen.getByRole("treeitem", {
      name: "Haiku, Needs a larger plan",
    });

    expect(row.getAttribute("aria-disabled")).toBe("true");
    expect(within(row).getByText("Needs a larger plan")).toBeTruthy();

    fireEvent.mouseEnter(row);
    expect(activeRowName()).toBe("Haiku, Needs a larger plan");
    press("Enter");
    fireEvent.click(row);

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("tree")).toBeTruthy();
  });

  it("shows free models with their badge and the same-named models with their ID", () => {
    renderPicker({
      value: "gpt",
      models: [
        GPT,
        pageModel("twin-a", { provider: "codex_cli", modelName: "Twin" }),
        pageModel("twin-b", { provider: "codex_cli", modelName: "Twin" }),
      ],
    });
    open();

    expect(screen.getByRole("treeitem", { name: "GPT, Free" })).toBeTruthy();
    expect(
      screen.getByRole("treeitem", { name: "Twin, vendor/twin-a" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("treeitem", { name: "Twin, vendor/twin-b" }),
    ).toBeTruthy();
  });

  it("labels the sources of a tool with several connections", () => {
    renderPicker({
      value: "a",
      models: [
        pageModel("a", {
          provider: "anthropic",
          connectionId: "c1",
          connectionName: "Main",
        }),
        pageModel("b", {
          provider: "anthropic",
          connectionId: "c2",
          connectionName: "Backup",
        }),
      ],
    });
    open();

    expect(screen.getByText("Main", { selector: "span" })).toBeTruthy();
    expect(screen.getByText("Backup", { selector: "span" })).toBeTruthy();
    expect(
      screen.getByRole("treeitem", { name: "Model a, Main" }),
    ).toBeTruthy();
  });
});

describe("panel content", () => {
  it("says the catalog is empty, or uses the place's own note", () => {
    const view = renderPicker({ models: [] });
    open();
    expect(
      screen.getByText("No model is released for this execution target."),
    ).toBeTruthy();

    view.unmount();
    renderPicker({ models: [], emptyLabel: "Nothing here yet" });
    open();
    expect(screen.getByText("Nothing here yet")).toBeTruthy();
  });

  it("warns about a failed catalog refresh by prop or by model flag", () => {
    renderPicker();
    open();
    expect(screen.queryByRole("alert")).toBeNull();
    cleanup();

    renderPicker({ isCatalogFailed: true });
    open();
    expect(screen.getByRole("alert").textContent).toContain(
      "could not be refreshed",
    );
    cleanup();

    renderPicker({
      models: [{ ...SONNET, isCatalogFailed: true }, HAIKU, GPT],
    });
    open();
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("keeps the focus in the search field when the list is clicked", () => {
    renderPicker();
    open();

    const onList = fireEvent.mouseDown(screen.getByRole("tree"));
    const onField = fireEvent.mouseDown(search());

    expect(onList).toBe(false);
    expect(onField).toBe(true);
  });

  it("scrolls the highlighted row into view", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    renderPicker();
    open();

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });
});

describe("leaving the picker", () => {
  it("closes when the focus moves to an element outside", () => {
    renderPicker();
    open();
    const outside = document.createElement("button");
    document.body.append(outside);

    fireEvent.blur(search(), { relatedTarget: outside });

    expect(screen.queryByRole("tree")).toBeNull();
    outside.remove();
  });

  it("closes when the focus leaves for nowhere", () => {
    renderPicker();
    open();

    fireEvent.blur(search(), { relatedTarget: null });

    expect(screen.queryByRole("tree")).toBeNull();
  });

  it("stays open while the focus moves inside the picker", () => {
    renderPicker();
    open();

    fireEvent.blur(search(), { relatedTarget: trigger() });

    expect(screen.getByRole("tree")).toBeTruthy();
  });
});
