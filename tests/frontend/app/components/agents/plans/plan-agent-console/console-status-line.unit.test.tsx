import { screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { ConsoleStatusLine } from "@/app/components/agents/plans/plan-agent-console/console-status-line";

import { renderConsole } from "./console-fixture";

// The ticking clock is a separate hook of the terminal surface; the status line only reads it.
vi.mock(
  "@/app/components/agents/plans/plan-agent-console/use-terminal-surface",
  () => ({ useNow: () => 1_790_000_100_000 }),
);

function line(): HTMLElement {
  return screen.getByTestId("plan-terminal-status");
}

it("says that the agent works when no call runs and no resume waits", () => {
  renderConsole(<ConsoleStatusLine tool={null} resumeAt={null} />);
  expect(line().textContent).toBe("Agent is working");
});

it("names the running call with its command and the seconds it runs", () => {
  renderConsole(
    <ConsoleStatusLine
      tool={{
        name: "Shell",
        detail: "pnpm test",
        startedAt: 1_790_000_100_000 - 42_000,
      }}
      resumeAt={null}
    />,
  );
  expect(line().textContent).toBe("Shellpnpm testrunning for 42 s");
  expect(screen.getByTitle("pnpm test")).toBeTruthy();
});

it("shows a running call without a counter when its start time is unreadable", () => {
  renderConsole(
    <ConsoleStatusLine
      tool={{ name: "Shell", detail: "", startedAt: null }}
      resumeAt={null}
    />,
  );
  expect(line().textContent).toBe("Shell");
});

it("counts down to a planned resume, and a past resume counts zero", () => {
  const { rerender } = renderConsole(
    <ConsoleStatusLine
      tool={{ name: "Shell", detail: "ignored", startedAt: null }}
      resumeAt={new Date(1_790_000_100_000 + 30_000).toISOString()}
    />,
  );
  expect(line().textContent).toBe("Resume plannedin 30 s");
  expect(line().textContent).not.toContain("Shell");
  rerender(
    <ConsoleStatusLine
      tool={null}
      resumeAt={new Date(1_790_000_100_000 - 5_000).toISOString()}
    />,
  );
  expect(line().textContent).toBe("Resume plannedin 0 s");
});
