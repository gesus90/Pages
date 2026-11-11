import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { expect, it, vi } from "vitest";

import { RemoteConsolePanel } from "@/app/components/agents/workspaces/remote/console/remote-console-panel";

import type { RemoteConsoleControls } from "@/app/components/agents/workspaces/remote/console/use-remote-console";
import type { RemoteConsoleTarget } from "@/app/components/agents/workspaces/remote/console/console-target";

const mocks = vi.hoisted(() => ({
  reconnect: vi.fn(),
  restart: vi.fn(),
  focus: vi.fn(),
  closeRequest: () => {},
  status: "connected",
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("react-router", () => ({ useBlocker: () => ({ state: "unblocked" }) }));
vi.mock(
  "@/app/components/agents/workspaces/remote/console/use-remote-console",
  () => ({
    useRemoteConsole: (options: {
      onCloseRequest: () => void;
    }): RemoteConsoleControls => {
      mocks.closeRequest = options.onCloseRequest;
      return {
        container: () => {},
        state: {
          status: mocks.status === "connected" ? "connected" : "ended",
          attempts: 0,
          message: null,
          exitCode: null,
          directory: null,
          setup: null,
        },
        hasConnected: true,
        reconnect: mocks.reconnect,
        restart: mocks.restart,
        focus: mocks.focus,
        contains: () => false,
      };
    },
  }),
);
vi.mock(
  "@/app/components/agents/workspaces/remote/console/console-body",
  () => ({
    ConsoleBody: (props: {
      onAction: (action: "review" | "reconnect" | "close") => void;
    }) => (
      <div>
        {(["review", "reconnect", "close"] as const).map((action) => (
          <button key={action} onClick={() => props.onAction(action)}>
            {action}
          </button>
        ))}
      </div>
    ),
    ConsoleFooter: () => null,
  }),
);

const TARGET: RemoteConsoleTarget = {
  endpoint: "/console",
  kind: "connection",
  title: "Server",
  hostName: "Server",
  address: null,
  endpointLabel: null,
  directory: null,
};

it("confirms active closure, lets the user return, and dispatches panel actions", () => {
  mocks.status = "connected";
  const onClose = vi.fn();
  const onReview = vi.fn();
  render(
    <RemoteConsolePanel
      target={TARGET}
      onClose={onClose}
      onReview={onReview}
      returnFocus={createRef()}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "remote.console.expand" }),
  );
  expect(
    screen
      .getByRole("button", { name: "remote.console.restore" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "review" }));
  fireEvent.click(screen.getByRole("button", { name: "reconnect" }));
  expect(onReview).toHaveBeenCalledOnce();
  expect(mocks.reconnect).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "remote.console.close" }));
  expect(screen.getByText("remote.console.closeDescription")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "remote.console.returnToConsole" }),
  );
  expect(onClose).not.toHaveBeenCalled();
  act(() => mocks.closeRequest());
  fireEvent.click(
    screen.getByRole("button", { name: "remote.console.endSession" }),
  );
  expect(onClose).toHaveBeenCalledOnce();
});

it("closes an ended session immediately", () => {
  mocks.status = "ended";
  const onClose = vi.fn();
  render(
    <RemoteConsolePanel
      target={TARGET}
      onClose={onClose}
      onReview={vi.fn()}
      returnFocus={createRef()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "remote.console.close" }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(screen.queryByText("remote.console.closeDescription")).toBeNull();
});
