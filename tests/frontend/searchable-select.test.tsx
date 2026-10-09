// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Dialog, DialogContent, DialogTitle } from "@/app/components/ui/dialog";
import { SearchableSelect } from "@/app/components/ui/searchable-select";
import { filterSearchableOptions } from "@/app/components/ui/searchable-select/use-searchable-select";

import type { SearchableSelectOption } from "@/app/components/ui/searchable-select/use-searchable-select";

const OPTIONS: readonly SearchableSelectOption[] = [
  {
    value: "alpha",
    label: "Alpha (OpenAI API)",
    keywords: ["OpenAI"],
    tags: ["levels"],
  },
  {
    value: "beta",
    label: "Beta (Codex CLI)",
    keywords: ["Codex CLI (ChatGPT account)"],
    tags: ["levels", "free"],
  },
  { value: "gamma", label: "Gamma", disabled: true },
  { value: "delta", label: "Delta (Z.AI API)", tags: ["free"] },
];
const TEXTS = {
  placeholder: "Choose an entry",
  unavailable: "Unavailable",
  search: "Search entries",
  empty: "No matching entry",
  count: (count: number, total: number) => `${count} of ${total} entries`,
};

function Harness(props: {
  readonly initial?: string;
  readonly disabled?: boolean;
  readonly withFilters?: boolean;
  readonly onChange?: (value: string) => void;
  readonly onSubmit?: () => void;
}): React.ReactElement {
  const [value, setValue] = useState(props.initial ?? "");
  function handleChange(next: string): void {
    setValue(next);
    props.onChange?.(next);
  }
  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    props.onSubmit?.();
  }
  return (
    <form onSubmit={handleSubmit}>
      <SearchableSelect
        id="entry"
        label="Entry"
        value={value}
        options={OPTIONS}
        onValueChange={handleChange}
        texts={TEXTS}
        disabled={props.disabled}
        filters={
          props.withFilters === false
            ? undefined
            : [
                { tag: "levels", label: "With levels" },
                { tag: "free", label: "Free" },
              ]
        }
      />
      <button type="button">Elsewhere</button>
    </form>
  );
}

function trigger(): HTMLElement {
  return screen.getByRole("combobox", { name: "Entry" });
}

function optionNames(): string[] {
  return screen
    .queryAllByRole("option")
    .map((option) => option.textContent ?? "");
}

function activeOption(): string | null {
  const id = screen
    .getByRole("searchbox", { name: "Search entries" })
    .getAttribute("aria-activedescendant");
  return id === null ? null : (document.getElementById(id)?.textContent ?? "");
}

describe("searchable select", () => {
  it("names the trigger by its label and shows the placeholder, the choice or an unavailable saved value", () => {
    const { unmount } = render(<Harness />);
    expect(trigger()).toHaveTextContent("Choose an entry");
    expect(trigger()).toHaveAttribute("aria-haspopup", "listbox");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(trigger()).not.toHaveAttribute("aria-controls");
    unmount();
    render(<Harness initial="beta" />);
    expect(trigger()).toHaveTextContent("Beta (Codex CLI)");
    render(<Harness initial="removed" disabled />);
    const unavailable = screen.getAllByRole("combobox", { name: "Entry" })[1];
    expect(unavailable).toHaveTextContent("removed (Unavailable)");
    expect(unavailable).toBeDisabled();
  });

  it("searches inside the open panel by every word of labels and keywords, ignoring case", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(trigger());
    const search = screen.getByRole("searchbox", { name: "Search entries" });
    expect(search).toHaveFocus();
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    const listbox = screen.getByRole("listbox", { name: "Entry" });
    expect(trigger()).toHaveAttribute("aria-controls", listbox.id);
    expect(search).toHaveAttribute("aria-controls", listbox.id);
    expect(screen.getByRole("status")).toHaveTextContent("4 of 4 entries");
    await user.type(search, "chatgpt");
    expect(optionNames()).toEqual(["Beta (Codex CLI)"]);
    await user.clear(search);
    await user.type(search, "  OPENAI   alpha ");
    expect(optionNames()).toEqual(["Alpha (OpenAI API)"]);
    await user.clear(search);
    await user.type(search, "zz");
    expect(optionNames()).toEqual([]);
    expect(screen.getByText("No matching entry")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("0 of 4 entries");
    expect(search).not.toHaveAttribute("aria-activedescendant");
  });

  it("moves the highlight over enabled options with arrows and chooses with Enter without submitting the form", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    render(<Harness onChange={onChange} onSubmit={onSubmit} />);
    await user.click(trigger());
    expect(activeOption()).toBe("Alpha (OpenAI API)");
    await user.keyboard("{ArrowDown}");
    expect(activeOption()).toBe("Beta (Codex CLI)");
    await user.keyboard("{ArrowDown}");
    expect(activeOption()).toBe("Delta (Z.AI API)");
    await user.keyboard("{ArrowDown}");
    expect(activeOption()).toBe("Alpha (OpenAI API)");
    await user.keyboard("{ArrowUp}");
    expect(activeOption()).toBe("Delta (Z.AI API)");
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledExactlyOnceWith("delta");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(trigger()).toHaveFocus();
    expect(trigger()).toHaveTextContent("Delta (Z.AI API)");
    await user.click(trigger());
    await user.keyboard("zz{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("opens from the trigger with arrow keys and highlights the saved choice", async () => {
    const user = userEvent.setup();
    render(<Harness initial="delta" withFilters={false} />);
    trigger().focus();
    await user.keyboard("a");
    expect(screen.queryByRole("listbox")).toBeNull();
    await user.keyboard("{ArrowUp}");
    expect(activeOption()).toBe("Delta (Z.AI API)");
    expect(
      screen.getByRole("option", { name: "Delta (Z.AI API)" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("option", { name: "Alpha (OpenAI API)" }),
    ).toHaveAttribute("aria-selected", "false");
    expect(screen.queryByRole("button", { name: "Free" })).toBeNull();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(trigger()).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.click(trigger());
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("closes only the panel on Escape inside a dialog and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Assignment</DialogTitle>
          <Harness />
        </DialogContent>
      </Dialog>,
    );
    await user.click(trigger());
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(trigger()).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("filters by pressed prefilters and keeps focus inside the panel until it leaves", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(trigger());
    const levels = screen.getByRole("button", { name: "With levels" });
    const free = screen.getByRole("button", { name: "Free" });
    expect(levels).toHaveAttribute("aria-pressed", "false");
    await user.click(levels);
    expect(levels).toHaveAttribute("aria-pressed", "true");
    expect(optionNames()).toEqual(["Alpha (OpenAI API)", "Beta (Codex CLI)"]);
    await user.click(free);
    expect(optionNames()).toEqual(["Beta (Codex CLI)"]);
    expect(screen.getByRole("status")).toHaveTextContent("1 of 4 entries");
    await user.click(levels);
    expect(optionNames()).toEqual(["Beta (Codex CLI)", "Delta (Z.AI API)"]);
    const search = screen.getByRole("searchbox", { name: "Search entries" });
    expect(search).toHaveFocus();
    expect(fireEvent.mouseDown(screen.getAllByRole("option")[0])).toBe(false);
    expect(fireEvent.mouseDown(search)).toBe(true);
    await user.tab();
    expect(levels).toHaveFocus();
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.queryByRole("listbox")).toBeNull();
    await user.click(trigger());
    // The prefilters stay pressed while the select is mounted; the search restarts.
    expect(screen.getByRole("button", { name: "Free" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("searchbox", { name: "Search entries" }),
    ).toHaveValue("");
  });

  it("ignores disabled options, highlights on hover and reveals the panel and highlight", async () => {
    const user = userEvent.setup();
    const reveal = vi.spyOn(Element.prototype, "scrollIntoView");
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(trigger());
    expect(reveal).toHaveBeenCalledWith({ block: "nearest" });
    const gamma = screen.getByRole("option", { name: "Gamma" });
    expect(gamma).toHaveAttribute("aria-disabled", "true");
    await user.hover(gamma);
    expect(activeOption()).toBe("Alpha (OpenAI API)");
    await user.click(gamma);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.hover(screen.getByRole("option", { name: "Beta (Codex CLI)" }));
    expect(activeOption()).toBe("Beta (Codex CLI)");
    await user.click(screen.getByRole("option", { name: "Beta (Codex CLI)" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("beta");
  });

  it("hides an open panel while disabled and leaves keys it does not handle to the page", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness />);
    await user.click(trigger());
    const listbox = within(document.body).getByRole("listbox");
    expect(listbox).toBeInTheDocument();
    rerender(<Harness disabled />);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    // Without a shown panel, Escape is left to the page again.
    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      cancelable: true,
    });
    window.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(false);
    rerender(<Harness />);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    const other = new KeyboardEvent("keydown", {
      key: "Tab",
      cancelable: true,
    });
    window.dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
  });

  it("matches nothing for an unknown tag and keeps options without keywords searchable", () => {
    expect(
      filterSearchableOptions(OPTIONS, "", ["unknown"]).map(
        (option) => option.value,
      ),
    ).toEqual([]);
    expect(
      filterSearchableOptions(OPTIONS, "gam", []).map((option) => option.value),
    ).toEqual(["gamma"]);
  });
});
