import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import {
  ConsoleBanner,
  ConsoleConnectionStatus,
} from "@/app/components/agents/workspaces/remote/console/console-status";
import { INITIAL_CONSOLE_STATE } from "@/app/components/agents/workspaces/remote/console/console-client";
import { INITIAL_SETUP_PROGRESS } from "@/definition/RemoteSetup";

import { renderTranslated } from "../../../plans/plan-panel-fixture";

import type { ConsoleView } from "@/app/components/agents/workspaces/remote/console/console-view";
import type { RemoteConsoleState } from "@/definition/RemoteConsole";

function state(
  overrides: Partial<RemoteConsoleState> = {},
): RemoteConsoleState {
  return { ...INITIAL_CONSOLE_STATE, ...overrides };
}

const STATUS_CASES: readonly (readonly [ConsoleView, string, string])[] = [
  ["connecting", "Connecting", "text-muted-foreground"],
  ["connected", "Connected", "text-success"],
  ["reconnecting", "Reconnecting · 3/10", "text-warning"],
  ["lost", "Connection lost", "text-destructive"],
  ["exited", "Session ended", "text-muted-foreground"],
  ["authFailed", "Sign-in failed", "text-destructive"],
  ["hostKeyChanged", "Check host key", "text-destructive"],
  ["unreachable", "Unreachable", "text-destructive"],
  ["ptyUnavailable", "Terminal unavailable", "text-destructive"],
  ["accessRevoked", "Access revoked", "text-destructive"],
  ["failed", "Connection failed", "text-destructive"],
];

it.each(STATUS_CASES)(
  "labels the %s view as '%s' in the tone %s",
  (view, label, toneClass) => {
    renderTranslated(
      <ConsoleConnectionStatus state={state({ attempts: 3 })} view={view} />,
    );

    const status = screen.getByRole("status");
    expect(status.textContent).toBe(label);
    expect(status.className).toContain(toneClass);
  },
);

it("shows at least the first attempt while the server counts none", () => {
  renderTranslated(
    <ConsoleConnectionStatus
      state={state({ attempts: 0 })}
      view="reconnecting"
    />,
  );

  expect(screen.getByRole("status").textContent).toBe("Reconnecting · 1/10");
});

it("offers a new session beside the connection-lost banner", () => {
  const onRestart = vi.fn();
  renderTranslated(
    <ConsoleBanner
      state={state({ attempts: 10, status: "blocked" })}
      view="lost"
      isSetup={false}
      onRestart={onRestart}
    />,
  );

  expect(
    screen.getByText(
      "Connection not restored after 10 attempts. The previous shell can no longer be reached.",
    ),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Start new session" }));
  expect(onRestart).toHaveBeenCalledTimes(1);
});

it("uses the singular for a single failed attempt", () => {
  renderTranslated(
    <ConsoleBanner
      state={state({ attempts: 1 })}
      view="lost"
      isSetup={false}
      onRestart={vi.fn()}
    />,
  );

  expect(
    screen.getByText(
      "Connection not restored after 1 attempt. The previous shell can no longer be reached.",
    ),
  ).toBeTruthy();
});

it("explains that a shell vanished with the server instead of counting attempts", () => {
  renderTranslated(
    <ConsoleBanner
      state={state({
        attempts: 4,
        status: "blocked",
        message: "remote.console.sessionLost",
      })}
      view="lost"
      isSetup={false}
      onRestart={vi.fn()}
    />,
  );

  expect(
    screen.getByText(
      "The old shell no longer exists (time window expired or Pages restarted). No input was repeated.",
    ),
  ).toBeTruthy();
});

it("shows the reconnect hint without a restart button", () => {
  renderTranslated(
    <ConsoleBanner
      state={state({ status: "reconnecting", attempts: 2 })}
      view="reconnecting"
      isSetup={false}
      onRestart={vi.fn()}
    />,
  );

  expect(
    screen.getByText("Connection interrupted. Trying to reconnect …"),
  ).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});

it("reports the exit status of a shell, with a dash when none is known", () => {
  const exited = renderTranslated(
    <ConsoleBanner
      state={state({ status: "ended", exitCode: 130 })}
      view="exited"
      isSetup={false}
      onRestart={vi.fn()}
    />,
  );
  expect(
    screen.getByText("The shell ended normally · exit status 130."),
  ).toBeTruthy();
  exited.unmount();

  renderTranslated(
    <ConsoleBanner
      state={state({ status: "ended", exitCode: null })}
      view="exited"
      isSetup={false}
      onRestart={vi.fn()}
    />,
  );
  expect(
    screen.getByText("The shell ended normally · exit status —."),
  ).toBeTruthy();
});

it("shows the setup wording and restart label for a setup console", () => {
  const onRestart = vi.fn();
  const lost = renderTranslated(
    <ConsoleBanner
      state={state({ status: "blocked" })}
      view="lost"
      isSetup
      onRestart={onRestart}
    />,
  );
  expect(
    screen.getByText(
      "The connection dropped. The script is not started again. Check the host and start the setup again if needed.",
    ),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Start setup again" }));
  expect(onRestart).toHaveBeenCalledTimes(1);
  lost.unmount();

  renderTranslated(
    <ConsoleBanner
      state={state({ status: "ended", exitCode: 2 })}
      view="exited"
      isSetup
      onRestart={onRestart}
    />,
  );
  expect(
    screen.getByText("The setup script has ended · exit status 2."),
  ).toBeTruthy();
});

it("uses a dash for an unknown setup exit status", () => {
  renderTranslated(
    <ConsoleBanner
      state={state({ status: "ended", exitCode: null })}
      view="exited"
      isSetup
      onRestart={vi.fn()}
    />,
  );

  expect(
    screen.getByText("The setup script has ended · exit status —."),
  ).toBeTruthy();
});

it("shows no banner for a setup in a view that keeps no scrollback notice", () => {
  const { container } = renderTranslated(
    <ConsoleBanner
      state={state({ status: "reconnecting" })}
      view="reconnecting"
      isSetup
      onRestart={vi.fn()}
    />,
  );

  expect(container.textContent).toBe("");
});

it("shows no banner for views without an interruption", () => {
  const { container } = renderTranslated(
    <ConsoleBanner
      state={state({ status: "connected" })}
      view="connected"
      isSetup={false}
      onRestart={vi.fn()}
    />,
  );

  expect(container.textContent).toBe("");
});

it("offers no restart once the setup was confirmed", () => {
  renderTranslated(
    <ConsoleBanner
      state={state({
        status: "ended",
        exitCode: 0,
        setup: { ...INITIAL_SETUP_PROGRESS, outcome: "confirmed" },
      })}
      view="exited"
      isSetup
      onRestart={vi.fn()}
    />,
  );

  expect(
    screen.getByText("The setup script has ended · exit status 0."),
  ).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});

it("still offers a restart after a partial setup", () => {
  renderTranslated(
    <ConsoleBanner
      state={state({
        status: "ended",
        exitCode: 1,
        setup: { ...INITIAL_SETUP_PROGRESS, outcome: "partial" },
      })}
      view="exited"
      isSetup
      onRestart={vi.fn()}
    />,
  );

  expect(
    screen.getByRole("button", { name: "Start setup again" }),
  ).toBeTruthy();
});
