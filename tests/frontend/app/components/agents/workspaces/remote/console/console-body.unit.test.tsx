import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import {
  ConsoleBody,
  ConsoleFooter,
} from "@/app/components/agents/workspaces/remote/console/console-body";
import { CONSOLE_MAXIMUM_RETRIES } from "@/definition/RemoteConsole";

import { state } from "./console-client-fixture";

import type { RemoteConsoleTarget } from "@/app/components/agents/workspaces/remote/console/console-target";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const TARGET: RemoteConsoleTarget = {
  endpoint: "/console",
  kind: "setup",
  title: "Server",
  hostName: "Server",
  address: null,
  endpointLabel: null,
  directory: null,
};

it("shows setup connection progress and hides the terminal behind the overlay", () => {
  render(
    <ConsoleBody
      container={() => undefined}
      target={TARGET}
      state={state({ attempts: 2 })}
      view="connecting"
      onAction={vi.fn()}
    />,
  );
  expect(screen.getByRole("status").textContent).toContain(
    "remote.setup.overlay.connecting.title",
  );
  expect(screen.getByText("remote.console.attempt")).toBeTruthy();
  expect(
    screen
      .getByLabelText("remote.console.terminalLabel")
      .getAttribute("aria-hidden"),
  ).toBe("true");
  expect(screen.queryByRole("button")).toBeNull();
});

it("offers reconnect until retries are exhausted and then closes", () => {
  const onAction = vi.fn();
  const { rerender } = render(
    <ConsoleBody
      container={() => undefined}
      target={TARGET}
      state={state({ message: null })}
      view="failed"
      onAction={onAction}
    />,
  );
  expect(screen.getByText("remote.failure.remote_failed")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "remote.console.reconnect" }),
  );
  expect(onAction).toHaveBeenLastCalledWith("reconnect");
  rerender(
    <ConsoleBody
      container={() => undefined}
      target={TARGET}
      state={state({
        attempts: CONSOLE_MAXIMUM_RETRIES,
        message: "remote.error.denied",
      })}
      view="failed"
      onAction={onAction}
    />,
  );
  expect(screen.getByText("remote.error.denied")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "remote.console.closeConsole" }),
  );
  expect(onAction).toHaveBeenLastCalledWith("close");
});

it("offers review for authentication failure and exposes a reconnecting terminal", () => {
  const onAction = vi.fn();
  const { rerender } = render(
    <ConsoleBody
      container={() => undefined}
      target={TARGET}
      state={state()}
      view="authFailed"
      onAction={onAction}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "remote.console.review" }),
  );
  expect(onAction).toHaveBeenCalledWith("review");
  rerender(
    <ConsoleBody
      container={() => undefined}
      target={TARGET}
      state={state()}
      view="reconnecting"
      onAction={onAction}
    />,
  );
  expect(screen.queryByRole("alert")).toBeNull();
  expect(
    screen
      .getByLabelText("remote.console.terminalLabel")
      .getAttribute("aria-hidden"),
  ).toBe("false");
});

it("uses setup-specific footer text for an open or exited setup", () => {
  const { rerender } = render(<ConsoleFooter kind="setup" view="connected" />);
  expect(screen.getByText("remote.setup.footer.connected")).toBeTruthy();
  rerender(<ConsoleFooter kind="connection" view="connected" />);
  expect(screen.getByText("remote.console.footer.connected")).toBeTruthy();
});
