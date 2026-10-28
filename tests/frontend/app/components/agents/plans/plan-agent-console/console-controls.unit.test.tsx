import { act, fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { ConsoleControls } from "@/app/components/agents/plans/plan-agent-console/console-controls";

import { renderConsole, sessionCommands, sessionView } from "./console-fixture";

import type { SessionCommands } from "@/app/components/agents/plans/plan-agent-console/use-session-commands";

const ALL_ACTIONS = {
  canSend: true,
  canCancelRun: true,
  canCancelTurn: true,
  canRecover: false,
};

it("describes the continuation mode and a known reason", () => {
  renderConsole(
    <ConsoleControls
      view={sessionView({
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
    screen.getByRole("heading", { name: "Continuation" }).textContent,
  ).toBe("Continuation");
  expect(screen.getByText("This session cannot be continued.")).toBeTruthy();
  expect(
    screen.getByText("The native session ended with its process."),
  ).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});

it("shows an unknown reason code as it is and the wait for a free slot", () => {
  renderConsole(
    <ConsoleControls
      view={sessionView({
        state: "waiting_for_capacity",
        continuation: {
          mode: "reconstructed",
          reason: "summary_bounded",
          hasPlanCheckpoint: true,
        },
      })}
      isReadOnly={false}
      commands={sessionCommands()}
    />,
  );
  expect(
    screen.getByText("New session with bounded context from this history."),
  ).toBeTruthy();
  expect(screen.getByText("summary_bounded")).toBeTruthy();
  expect(
    screen.getByText(
      "The node waits for a free agent slot; it starts once one is free.",
    ),
  ).toBeTruthy();
});

it("cancels the running turn through the command boundary", () => {
  const cancel = vi.fn<SessionCommands["cancel"]>(async () => undefined);
  renderConsole(
    <ConsoleControls
      view={sessionView({ actions: ALL_ACTIONS })}
      isReadOnly={false}
      commands={sessionCommands({ cancel })}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel turn" }));
  expect(cancel).toHaveBeenCalledWith("turn");
});

it("stops the run only after a second confirming click and resets the confirmation on blur", async () => {
  const cancel = vi.fn<SessionCommands["cancel"]>(async () => undefined);
  renderConsole(
    <ConsoleControls
      view={sessionView({ actions: ALL_ACTIONS })}
      isReadOnly={false}
      commands={sessionCommands({ cancel })}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Stop run" }));
  expect(cancel).not.toHaveBeenCalled();
  fireEvent.blur(
    screen.getByRole("button", { name: "Really stop the whole run?" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Stop run" }));
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Really stop the whole run?" }),
    );
    await Promise.resolve();
  });
  expect(cancel).toHaveBeenCalledOnce();
  expect(cancel).toHaveBeenCalledWith("run");
  expect(screen.getByRole("button", { name: "Stop run" })).toBeTruthy();
});

it("disables the stops while a command is pending and hides them in a read-only history", () => {
  const { rerender } = renderConsole(
    <ConsoleControls
      view={sessionView({ actions: ALL_ACTIONS })}
      isReadOnly={false}
      commands={sessionCommands({ isPending: true })}
    />,
  );
  for (const button of screen.getAllByRole("button"))
    expect(button.hasAttribute("disabled")).toBe(true);
  rerender(
    <ConsoleControls
      view={sessionView({ actions: ALL_ACTIONS })}
      isReadOnly
      commands={sessionCommands()}
    />,
  );
  expect(screen.queryByRole("button")).toBeNull();
});
