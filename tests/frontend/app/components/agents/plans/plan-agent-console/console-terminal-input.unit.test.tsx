import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { ConsoleTerminalInput } from "@/app/components/agents/plans/plan-agent-console/console-terminal-input";

import { renderConsole, sessionCommands } from "./console-fixture";

import type { SessionCommands } from "@/app/components/agents/plans/plan-agent-console/use-session-commands";

function field(): HTMLTextAreaElement {
  const element = screen.getByRole("textbox", {
    name: "Message to the agent",
  });
  if (!(element instanceof HTMLTextAreaElement))
    throw new Error("Input is no text area");
  return element;
}

function type(value: string): void {
  fireEvent.change(field(), { target: { value } });
}

function put(value: string, start: number, end = start): void {
  type(value);
  field().setSelectionRange(start, end);
}

it("shows the placeholder only while the line is empty", () => {
  renderConsole(
    <ConsoleTerminalInput commands={sessionCommands()} canInterrupt={false} />,
  );
  expect(document.getElementById("terminal-input-hint")?.textContent).toBe(
    "Enter sends · Shift+Enter new line · Ctrl+C interrupts",
  );
  expect(field().getAttribute("aria-describedby")).toBe("terminal-input-hint");
  expect(document.querySelector("span.animate-pulse")).not.toBeNull();
  type("x");
  expect(document.querySelector("span.animate-pulse")).toBeNull();
  expect(field().className).toContain("caret-agent-terminal-strong");
  type("");
  expect(field().className).toContain("caret-transparent");
});

it("grows with its lines up to eight rows", () => {
  renderConsole(
    <ConsoleTerminalInput commands={sessionCommands()} canInterrupt={false} />,
  );
  expect(field().rows).toBe(1);
  type("a\nb\nc");
  expect(field().rows).toBe(3);
  type(Array.from({ length: 20 }, () => "x").join("\n"));
  expect(field().rows).toBe(8);
});

it("sends on Enter, clears and recalls the input with the arrow keys", async () => {
  const send = vi.fn<SessionCommands["send"]>(async () => true);
  renderConsole(
    <ConsoleTerminalInput
      commands={sessionCommands({ send })}
      canInterrupt={false}
    />,
  );
  type("first");
  fireEvent.keyDown(field(), { key: "Enter" });
  await waitFor(() => expect(field().value).toBe(""));
  type("second");
  fireEvent.keyDown(field(), { key: "Enter" });
  await waitFor(() => expect(field().value).toBe(""));
  expect(send.mock.calls).toEqual([["first"], ["second"]]);

  fireEvent.keyDown(field(), { key: "ArrowUp" });
  expect(field().value).toBe("second");
  fireEvent.keyDown(field(), { key: "ArrowUp" });
  expect(field().value).toBe("first");
  // Before the oldest input nothing is recalled.
  fireEvent.keyDown(field(), { key: "ArrowUp" });
  expect(field().value).toBe("first");
  fireEvent.keyDown(field(), { key: "ArrowDown" });
  expect(field().value).toBe("second");
  // Past the newest input the line is empty again, and then nothing follows.
  fireEvent.keyDown(field(), { key: "ArrowDown" });
  expect(field().value).toBe("");
  fireEvent.keyDown(field(), { key: "ArrowDown" });
  expect(field().value).toBe("");
});

it("keeps the text when the backend refused the input, so it is not lost or remembered", async () => {
  const send = vi.fn<SessionCommands["send"]>(async () => false);
  renderConsole(
    <ConsoleTerminalInput
      commands={sessionCommands({ send })}
      canInterrupt={false}
    />,
  );
  type("refused");
  fireEvent.keyDown(field(), { key: "Enter" });
  await waitFor(() => expect(send).toHaveBeenCalledWith("refused"));
  await Promise.resolve();
  expect(field().value).toBe("refused");
  type("");
  fireEvent.keyDown(field(), { key: "ArrowUp" });
  expect(field().value).toBe("");
});

it("sends nothing for a blank line, while a command is pending, with Shift+Enter or during composition", () => {
  const send = vi.fn<SessionCommands["send"]>(async () => true);
  const { rerender } = renderConsole(
    <ConsoleTerminalInput
      commands={sessionCommands({ send })}
      canInterrupt={false}
    />,
  );
  type("   \n ");
  fireEvent.keyDown(field(), { key: "Enter" });
  type("text");
  fireEvent.keyDown(field(), { key: "Enter", shiftKey: true });
  fireEvent.keyDown(field(), { key: "Enter", isComposing: true });
  expect(send).not.toHaveBeenCalled();
  rerender(
    <ConsoleTerminalInput
      commands={sessionCommands({ send, isPending: true })}
      canInterrupt={false}
    />,
  );
  fireEvent.keyDown(field(), { key: "Enter" });
  expect(send).not.toHaveBeenCalled();
});

it("sends when the form is submitted", async () => {
  const send = vi.fn<SessionCommands["send"]>(async () => true);
  renderConsole(
    <ConsoleTerminalInput
      commands={sessionCommands({ send })}
      canInterrupt={false}
    />,
  );
  type("by form");
  const form = field().closest("form");
  if (!form) throw new Error("Form missing");
  fireEvent.submit(form);
  await waitFor(() => expect(send).toHaveBeenCalledWith("by form"));
});

it("interrupts the turn with Escape and with Ctrl+C without a selection, only while a turn can be interrupted", () => {
  const cancel = vi.fn<SessionCommands["cancel"]>(async () => undefined);
  const { rerender } = renderConsole(
    <ConsoleTerminalInput
      commands={sessionCommands({ cancel })}
      canInterrupt
    />,
  );
  put("abc", 1);
  expect(fireEvent.keyDown(field(), { key: "Escape" })).toBe(false);
  expect(cancel).toHaveBeenLastCalledWith("turn");
  expect(fireEvent.keyDown(field(), { key: "c", ctrlKey: true })).toBe(false);
  expect(cancel).toHaveBeenCalledTimes(2);
  // A selection keeps Ctrl+C as copy.
  put("abc", 0, 3);
  expect(fireEvent.keyDown(field(), { key: "c", ctrlKey: true })).toBe(true);
  expect(fireEvent.keyDown(field(), { key: "c" })).toBe(true);
  expect(cancel).toHaveBeenCalledTimes(2);
  rerender(
    <ConsoleTerminalInput
      commands={sessionCommands({ cancel })}
      canInterrupt={false}
    />,
  );
  expect(fireEvent.keyDown(field(), { key: "Escape" })).toBe(false);
  expect(cancel).toHaveBeenCalledTimes(2);
});

it("recalls only from the edge line of a multi-line input", async () => {
  renderConsole(
    <ConsoleTerminalInput commands={sessionCommands()} canInterrupt={false} />,
  );
  type("old");
  fireEvent.keyDown(field(), { key: "Enter" });
  await waitFor(() => expect(field().value).toBe(""));
  put("one\ntwo", 5);
  // The cursor sits in the second line, so arrow up moves inside the text.
  expect(fireEvent.keyDown(field(), { key: "ArrowUp" })).toBe(true);
  expect(field().value).toBe("one\ntwo");
  put("one\ntwo", 1);
  expect(fireEvent.keyDown(field(), { key: "ArrowUp" })).toBe(false);
  expect(field().value).toBe("old");
  put("one\ntwo", 1);
  // Arrow down in the first of two lines also stays in the text.
  expect(fireEvent.keyDown(field(), { key: "ArrowDown" })).toBe(true);
  expect(field().value).toBe("one\ntwo");
});

it("shows the error of a failed command as an alert and no notice of success", () => {
  const { rerender } = renderConsole(
    <ConsoleTerminalInput
      commands={sessionCommands({
        notice: { tone: "alert", code: "plan_acp_session_failed" },
      })}
      canInterrupt={false}
    />,
  );
  expect(screen.getByRole("alert").textContent).toBe(
    "The Codex ACP session failed before or during its turn.",
  );
  rerender(
    <ConsoleTerminalInput
      commands={sessionCommands({
        notice: { tone: "alert", code: "zz_unknown_code" },
      })}
      canInterrupt={false}
    />,
  );
  expect(screen.getByRole("alert").textContent).not.toBe("");
  rerender(
    <ConsoleTerminalInput
      commands={sessionCommands({ notice: { tone: "status", code: "queued" } })}
      canInterrupt={false}
    />,
  );
  expect(screen.queryByRole("alert")).toBeNull();
});
