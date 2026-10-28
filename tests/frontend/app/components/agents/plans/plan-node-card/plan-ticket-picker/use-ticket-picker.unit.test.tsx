import { act, renderHook } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import { useTicketPicker } from "@/app/components/agents/plans/plan-node-card/plan-ticket-picker/use-ticket-picker";

import { i18n } from "../../plan-flow-fixture";
import { ticket } from "./ticket-picker-fixture";

import type { KeyboardEvent } from "react";
import type { TicketPickerState } from "@/app/components/agents/plans/plan-node-card/plan-ticket-picker/use-ticket-picker";
import type { AgentPlanTask } from "@/definition/AgentPlan";

const TASKS: readonly AgentPlanTask[] = [
  ticket("1", { title: "Alpha", updatedAt: "2026-01-03 08:00:00" }),
  ticket("2", {
    title: "Beta",
    statusKey: "done",
    updatedAt: "2026-01-02 08:00:00",
  }),
  ticket("3", { title: "Gamma", updatedAt: "2026-01-01 08:00:00" }),
];

interface PickerOptions {
  readonly tasks?: readonly AgentPlanTask[];
  readonly selectedId?: string;
  readonly disabled?: boolean;
  readonly onOpen?: () => void;
}

function renderPicker(options: PickerOptions = {}): {
  readonly current: () => TicketPickerState;
  readonly onSelect: ReturnType<typeof vi.fn>;
  readonly rerender: (next: PickerOptions) => void;
} {
  const onSelect = vi.fn();
  const { result, rerender } = renderHook(
    (props: PickerOptions) =>
      useTicketPicker({
        tasks: props.tasks ?? TASKS,
        selectedId: props.selectedId ?? "",
        disabled: props.disabled ?? false,
        onSelect,
        onOpen: props.onOpen,
      }),
    {
      initialProps: options,
      wrapper: ({ children }) => (
        <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
      ),
    },
  );
  return {
    current: () => result.current,
    onSelect,
    rerender: (next) => rerender({ ...options, ...next }),
  };
}

function key(
  name: string,
  isComposing = false,
): KeyboardEvent<HTMLInputElement> & { readonly preventDefault: () => void } {
  const preventDefault = vi.fn();
  // The hook reads only the key, the composition state and preventDefault.
  return {
    key: name,
    nativeEvent: { isComposing },
    preventDefault,
  } as unknown as KeyboardEvent<HTMLInputElement>;
}

it("opens with a cleared search, runs the open callback and closes again on toggle", () => {
  const onOpen = vi.fn();
  const picker = renderPicker({ onOpen });
  act(() => picker.current().search("beta"));
  act(() => picker.current().toggle());
  expect(picker.current().isOpen).toBe(true);
  expect(picker.current().query.text).toBe("");
  expect(onOpen).toHaveBeenCalledOnce();
  act(() => picker.current().toggle());
  expect(picker.current().isOpen).toBe(false);
  act(() => picker.current().toggle());
  expect(picker.current().isOpen).toBe(true);
});

it("stays closed while disabled and opens without an open callback", () => {
  const picker = renderPicker({ disabled: true });
  act(() => picker.current().toggle());
  expect(picker.current().isOpen).toBe(false);
  picker.rerender({ disabled: false });
  expect(picker.current().isOpen).toBe(true);
});

it("starts the highlight at the chosen ticket, else at the first match, and none without matches", () => {
  expect(renderPicker({ selectedId: "2" }).current().active?.id).toBe("2");
  expect(renderPicker({ selectedId: "gone" }).current().active?.id).toBe("1");
  expect(renderPicker({ tasks: [] }).current().active).toBeNull();
});

it("moves the highlight with the arrows within the list and chooses it with Enter", () => {
  const picker = renderPicker();
  act(() => picker.current().toggle());
  const down = key("ArrowDown");
  act(() => picker.current().handleSearchKeyDown(down));
  expect(down.preventDefault).toHaveBeenCalled();
  act(() => picker.current().handleSearchKeyDown(key("ArrowDown")));
  act(() => picker.current().handleSearchKeyDown(key("ArrowDown")));
  expect(picker.current().active?.id).toBe("3");
  act(() => picker.current().handleSearchKeyDown(key("ArrowUp")));
  expect(picker.current().active?.id).toBe("2");
  act(() => picker.current().handleSearchKeyDown(key("Enter")));
  expect(picker.onSelect).toHaveBeenCalledWith("2");
  expect(picker.current().isOpen).toBe(false);
});

it("ignores other keys, Enter while composing and arrows or Enter without matches", () => {
  const picker = renderPicker({ tasks: [] });
  const letter = key("a");
  act(() => picker.current().handleSearchKeyDown(letter));
  expect(letter.preventDefault).not.toHaveBeenCalled();
  act(() => picker.current().handleSearchKeyDown(key("ArrowDown")));
  act(() => picker.current().handleSearchKeyDown(key("Enter")));
  expect(picker.current().active).toBeNull();
  const filled = renderPicker();
  const composing = key("Enter", true);
  act(() => filled.current().handleSearchKeyDown(composing));
  expect(composing.preventDefault).not.toHaveBeenCalled();
  expect(filled.onSelect).not.toHaveBeenCalled();
});

it("keeps the highlight on the first match when moving above it after the highlighted ticket was filtered out", () => {
  const picker = renderPicker();
  act(() => picker.current().highlight(TASKS[2] ?? ticket("x")));
  act(() => picker.current().search("alpha"));
  act(() => picker.current().handleSearchKeyDown(key("ArrowUp")));
  expect(picker.current().active?.id).toBe("1");
});

it("chooses a row only when it differs from the node's ticket and returns the focus to the field", () => {
  const picker = renderPicker({ selectedId: "1" });
  const field = document.createElement("button");
  document.body.append(field);
  picker.current().trigger.current = field;
  act(() => picker.current().toggle());
  act(() => picker.current().choose(TASKS[0] ?? ticket("x")));
  expect(picker.onSelect).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(field);
  act(() => picker.current().choose(TASKS[1] ?? ticket("x")));
  expect(picker.onSelect).toHaveBeenCalledWith("2");
  field.remove();
});

it("closes without focusing a field that is not rendered", () => {
  const picker = renderPicker();
  act(() => picker.current().toggle());
  act(() => picker.current().close(true));
  expect(picker.current().isOpen).toBe(false);
});

it("filters by phases, orders and resets search and phases together", () => {
  const picker = renderPicker();
  act(() => picker.current().togglePhase("done"));
  expect(picker.current().results.map((task) => task.id)).toEqual(["2"]);
  act(() => picker.current().togglePhase("todo"));
  act(() => picker.current().togglePhase("done"));
  expect(picker.current().query.phases).toEqual(["todo"]);
  act(() => picker.current().setPhases(["done", "todo"]));
  expect(picker.current().query.phases).toEqual(["done", "todo"]);
  act(() => picker.current().sortBy("title"));
  expect(picker.current().query).toMatchObject({
    sort: "title",
    direction: "asc",
  });
  act(() => picker.current().toggleDirection());
  expect(picker.current().query.direction).toBe("desc");
  act(() => picker.current().toggleDirection());
  expect(picker.current().query.direction).toBe("asc");
  act(() => picker.current().sortBy("created"));
  expect(picker.current().query.direction).toBe("desc");
  act(() => picker.current().search("gamma"));
  act(() => picker.current().reset());
  expect(picker.current().query).toEqual({
    text: "",
    phases: [],
    sort: "created",
    direction: "desc",
  });
});
