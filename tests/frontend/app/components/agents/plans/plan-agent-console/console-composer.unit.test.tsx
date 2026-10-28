import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { ConsoleComposer } from "@/app/components/agents/plans/plan-agent-console/console-composer";

import {
  renderConsole,
  sessionCommands,
  sessionMessage,
  sessionView,
} from "./console-fixture";

import type { SessionCommands } from "@/app/components/agents/plans/plan-agent-console/use-session-commands";

function field(): HTMLTextAreaElement {
  const element = screen.getByRole("textbox", {
    name: "Instruction to the agent",
  });
  if (!(element instanceof HTMLTextAreaElement))
    throw new Error("Instruction field is no text area");
  return element;
}

function sendButton(): HTMLElement {
  return screen.getByRole("button", { name: "Send instruction" });
}

it("sends on Enter while a turn runs and clears the field only after the backend confirmed", async () => {
  const send = vi.fn<SessionCommands["send"]>(async () => true);
  renderConsole(
    <ConsoleComposer
      view={sessionView({ state: "running" })}
      isReadOnly={false}
      commands={sessionCommands({ send })}
    />,
  );
  expect(
    screen.getByText(
      "A turn is running: a new instruction is queued and follows once it ended.",
    ),
  ).toBeTruthy();
  expect(field().getAttribute("aria-describedby")).toBeNull();
  expect(sendButton().hasAttribute("disabled")).toBe(true);
  fireEvent.change(field(), { target: { value: "Check the tests" } });
  expect(sendButton().hasAttribute("disabled")).toBe(false);
  fireEvent.keyDown(field(), { key: "Enter" });
  await waitFor(() => expect(field().value).toBe(""));
  expect(send).toHaveBeenCalledWith("Check the tests");
});

it("takes the focus once, when the field first accepts input, and never steals it later", () => {
  const commands = sessionCommands();
  const { rerender } = renderConsole(
    <ConsoleComposer view={sessionView()} isReadOnly commands={commands} />,
  );
  expect(document.activeElement).not.toBe(field());
  rerender(
    <ConsoleComposer
      view={sessionView()}
      isReadOnly={false}
      commands={commands}
    />,
  );
  expect(document.activeElement).toBe(field());
  field().blur();
  rerender(
    <ConsoleComposer view={sessionView()} isReadOnly commands={commands} />,
  );
  rerender(
    <ConsoleComposer
      view={sessionView()}
      isReadOnly={false}
      commands={commands}
    />,
  );
  expect(document.activeElement).not.toBe(field());
});

it("keeps the text when the backend refused and submits through the send button", async () => {
  const send = vi.fn<SessionCommands["send"]>(async () => false);
  renderConsole(
    <ConsoleComposer
      view={sessionView()}
      isReadOnly={false}
      commands={sessionCommands({ send })}
    />,
  );
  expect(
    screen.queryByText(
      "A turn is running: a new instruction is queued and follows once it ended.",
    ),
  ).toBeNull();
  fireEvent.change(field(), { target: { value: "Retry later" } });
  fireEvent.click(sendButton());
  await waitFor(() => expect(send).toHaveBeenCalledWith("Retry later"));
  expect(field().value).toBe("Retry later");
});

it("breaks lines and ignores composition, other keys, blank text and a pending command", async () => {
  const send = vi.fn<SessionCommands["send"]>(async () => true);
  const { rerender } = renderConsole(
    <ConsoleComposer
      view={sessionView()}
      isReadOnly={false}
      commands={sessionCommands({ send })}
    />,
  );
  fireEvent.change(field(), { target: { value: "   " } });
  fireEvent.keyDown(field(), { key: "Enter" });
  fireEvent.change(field(), { target: { value: "Line" } });
  fireEvent.keyDown(field(), { key: "a" });
  fireEvent.keyDown(field(), { key: "Enter", shiftKey: true });
  fireEvent.keyDown(field(), { key: "Enter", isComposing: true });
  fireEvent.keyDown(field(), { key: "Enter", keyCode: 229 });
  rerender(
    <ConsoleComposer
      view={sessionView()}
      isReadOnly={false}
      commands={sessionCommands({ send, isPending: true })}
    />,
  );
  expect(sendButton().hasAttribute("disabled")).toBe(true);
  await act(async () => {
    fireEvent.keyDown(field(), { key: "Enter" });
    await Promise.resolve();
  });
  expect(send).not.toHaveBeenCalled();
  expect(field().value).toBe("Line");
});

it("locks a read-only history with its reason and never sends from it", async () => {
  const send = vi.fn<SessionCommands["send"]>(async () => true);
  renderConsole(
    <ConsoleComposer
      view={sessionView({ state: "running" })}
      isReadOnly
      commands={sessionCommands({ send })}
    />,
  );
  const reason = screen.getByText("This run is history and read only.");
  expect(field().hasAttribute("disabled")).toBe(true);
  expect(field().getAttribute("aria-describedby")).toBe(reason.id);
  expect(document.activeElement).not.toBe(field());
  expect(
    screen.queryByText(
      "A turn is running: a new instruction is queued and follows once it ended.",
    ),
  ).toBeNull();
  fireEvent.change(field(), { target: { value: "Ignored" } });
  await act(async () => {
    fireEvent.keyDown(field(), { key: "Enter" });
    await Promise.resolve();
  });
  expect(send).not.toHaveBeenCalled();
});

it("names the continuation reason of an unavailable session and a generic lock otherwise", () => {
  const blocked = {
    canSend: false,
    canCancelRun: false,
    canCancelTurn: false,
    canRecover: false,
  };
  const { rerender } = renderConsole(
    <ConsoleComposer
      view={sessionView({
        actions: blocked,
        continuation: {
          mode: "unavailable",
          reason: "native_session_ended",
          hasPlanCheckpoint: false,
        },
      })}
      isReadOnly={false}
      commands={sessionCommands()}
    />,
  );
  expect(
    screen.getByText("The native session ended with its process."),
  ).toBeTruthy();
  rerender(
    <ConsoleComposer
      view={sessionView({
        actions: blocked,
        continuation: {
          mode: "unavailable",
          reason: null,
          hasPlanCheckpoint: false,
        },
      })}
      isReadOnly={false}
      commands={sessionCommands()}
    />,
  );
  expect(
    screen.getByText("The session takes no instruction right now."),
  ).toBeTruthy();
  rerender(
    <ConsoleComposer
      view={sessionView({ actions: blocked })}
      isReadOnly={false}
      commands={sessionCommands()}
    />,
  );
  expect(
    screen.getByText("The session takes no instruction right now."),
  ).toBeTruthy();
});

it("lists the five newest open instructions with their delivery status", () => {
  const messages = [
    sessionMessage("1", "queued"),
    sessionMessage("2", "delivered"),
    sessionMessage("3", "delivering"),
    sessionMessage("4", "uncertain"),
    sessionMessage("5", "cancelled"),
    sessionMessage("6", "failed"),
    sessionMessage("7", "queued"),
    sessionMessage("8", "queued"),
  ];
  renderConsole(
    <ConsoleComposer
      view={sessionView({ messages })}
      isReadOnly={false}
      commands={sessionCommands()}
    />,
  );
  const list = screen.getByRole("list", { name: "Open instructions" });
  const items = [...list.querySelectorAll("li")].map(
    (item) => item.textContent,
  );
  expect(items).toEqual([
    "DeliveringInstruction 3",
    "Delivery uncertain (server stopped; not repeated)Instruction 4",
    "Not deliveredInstruction 6",
    "QueuedInstruction 7",
    "QueuedInstruction 8",
  ]);
});

it("shows no open list when every instruction is delivered or cancelled", () => {
  renderConsole(
    <ConsoleComposer
      view={sessionView({
        messages: [
          sessionMessage("1", "delivered"),
          sessionMessage("2", "cancelled"),
        ],
      })}
      isReadOnly={false}
      commands={sessionCommands()}
    />,
  );
  expect(screen.queryByRole("list")).toBeNull();
});

it("announces the confirmed result as status and a refusal as alert with a general fallback", () => {
  const { rerender } = renderConsole(
    <ConsoleComposer
      view={sessionView()}
      isReadOnly={false}
      commands={sessionCommands({
        notice: { tone: "status", code: "queued" },
      })}
    />,
  );
  expect(screen.getByRole("status").textContent).toBe(
    "Instruction stored and queued; it follows the running turn.",
  );
  rerender(
    <ConsoleComposer
      view={sessionView()}
      isReadOnly={false}
      commands={sessionCommands({
        notice: { tone: "alert", code: "unknown_refusal_code" },
      })}
    />,
  );
  expect(screen.getByRole("alert").textContent).toBe(
    "The action could not be completed. Try again.",
  );
  expect(screen.queryByRole("status")).toBeNull();
});
