import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { Dialog } from "@/app/components/ui/dialog";
import { ConsoleHeading } from "@/app/components/agents/workspaces/remote/console/console-heading";
import { SetupProgressPanel } from "@/app/components/agents/workspaces/remote/console/setup-progress";
import { INITIAL_SETUP_PROGRESS } from "@/definition/RemoteSetup";

import type { RemoteConsoleTarget } from "@/app/components/agents/workspaces/remote/console/console-target";
import type { RemoteConsoleState } from "@/definition/RemoteConsole";
import type { SetupProgress } from "@/definition/RemoteSetup";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const STATE: RemoteConsoleState = {
  status: "connecting",
  attempts: 0,
  message: null,
  exitCode: null,
  directory: null,
  setup: null,
};
const TARGET: RemoteConsoleTarget = {
  endpoint: "/console",
  kind: "connection",
  title: "Server",
  hostName: "Server",
  address: "user@host:22",
  endpointLabel: "host:22",
  directory: null,
};

it("shows the connection and directory state and invokes the heading controls", () => {
  const onClose = vi.fn();
  const onToggleExpanded = vi.fn();
  const { rerender } = render(
    <ConsoleHeading
      target={TARGET}
      state={STATE}
      view="connecting"
      isExpanded={false}
      onClose={onClose}
      onToggleExpanded={onToggleExpanded}
    />,
    { wrapper: ({ children }) => <Dialog open>{children}</Dialog> },
  );
  expect(screen.getByText("user@host:22")).toBeTruthy();
  expect(screen.getByText("remote.console.directoryPending")).toBeTruthy();
  expect(screen.getByText("remote.console.directConnection")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "remote.console.expand" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "remote.console.close" }));
  expect(onToggleExpanded).toHaveBeenCalledOnce();
  expect(onClose).toHaveBeenCalledOnce();
  rerender(
    <ConsoleHeading
      target={{ ...TARGET, kind: "workspace", directory: "/work" }}
      state={{ ...STATE, directory: "/actual" }}
      view="connected"
      isExpanded
      onClose={onClose}
      onToggleExpanded={onToggleExpanded}
    />,
  );
  expect(screen.getByText("/actual")).toBeTruthy();
  expect(screen.getByText("remote.console.workspaceOn")).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "remote.console.restore" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  rerender(
    <ConsoleHeading
      target={{ ...TARGET, kind: "setup", address: null }}
      state={STATE}
      view="failed"
      isExpanded={false}
      onClose={onClose}
      onToggleExpanded={onToggleExpanded}
    />,
  );
  expect(screen.getByText("remote.setup.description")).toBeTruthy();
  expect(screen.getByText("remote.console.directoryUnavailable")).toBeTruthy();
  expect(screen.queryByText("user@host:22")).toBeNull();
});

function progress(overrides: Partial<SetupProgress>): SetupProgress {
  return { ...INITIAL_SETUP_PROGRESS, ...overrides };
}

it("shows preparation states and the current phase while setup runs", () => {
  const setup = progress({
    phases: [
      "running",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
    ],
    step: "upload",
  });
  render(
    <SetupProgressPanel
      state={{ ...STATE, setup }}
      view="connected"
      hostName="Server"
    />,
  );
  const preparation = screen.getByRole("list", {
    name: "remote.setup.preparation.label",
  });
  const steps = within(preparation).getAllByRole("listitem");
  expect(steps[0]?.textContent).toContain("remote.setup.state.done");
  expect(steps[2]?.textContent).toContain("remote.setup.state.running");
  expect(steps[3]?.textContent).toContain("remote.setup.state.pending");
  const phases = screen.getByRole("list", { name: "remote.setup.phasesLabel" });
  expect(
    within(phases).getAllByRole("listitem")[0]?.getAttribute("aria-current"),
  ).toBe("step");
  expect(screen.getByRole("status").textContent).toBe(
    "remote.setup.headline.running",
  );
});

it("reports waiting and finished outcomes with the appropriate current phase", () => {
  const waiting = progress({
    phases: [
      "done",
      "waiting",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
    ],
  });
  const { rerender } = render(
    <SetupProgressPanel
      state={{ ...STATE, setup: waiting }}
      view="connected"
      hostName="Server"
    />,
  );
  expect(screen.getByRole("status").textContent).toBe(
    "remote.setup.headline.waiting",
  );
  expect(
    screen.queryByRole("list", { name: "remote.setup.preparation.label" }),
  ).toBeNull();
  for (const outcome of ["confirmed", "partial", "failed"] as const) {
    const setup = progress({
      phases: [
        "failed",
        "pending",
        "pending",
        "pending",
        "pending",
        "pending",
        "pending",
        "pending",
      ],
      step: "connection",
      outcome,
      reason: "remote.error.denied",
    });
    rerender(
      <SetupProgressPanel
        state={{ ...STATE, setup }}
        view="failed"
        hostName="Server"
      />,
    );
    expect(screen.getByRole("status").textContent).toBe(
      `remote.setup.headline.${outcome}`,
    );
    expect(
      screen.getByText("remote.setup.preparation.connection").textContent,
    ).toContain("remote.setup.state.failed");
  }
});
