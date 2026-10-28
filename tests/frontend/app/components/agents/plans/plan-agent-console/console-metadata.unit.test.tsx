import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { ConsoleMetadata } from "@/app/components/agents/plans/plan-agent-console/console-metadata";

import { cliSession, renderConsole, sessionView } from "./console-fixture";

import type { AgentSessionGitState } from "@/definition/AgentSessionJournal";

const REPORTED = { source: "plan", reportedAt: null } as const;

function stubClipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

function field(name: string): string | null {
  const term = screen.getByText(name, { selector: "dt" });
  return term.nextElementSibling?.textContent ?? null;
}

function withGit(git: AgentSessionGitState): React.ReactElement {
  return (
    <ConsoleMetadata
      view={sessionView({
        workspace: { directory: "/repo", git, checkedAt: "2026-10-26" },
      })}
      record={cliSession({ sessionId: null })}
      lastActivity={null}
    />
  );
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "clipboard");
});

it("reads every value nobody reported as unknown", () => {
  renderConsole(
    <ConsoleMetadata
      view={sessionView()}
      record={cliSession({ sessionId: null })}
      lastActivity={null}
    />,
  );
  for (const name of [
    "Directory",
    "Git branch",
    "Model requested",
    "Model confirmed",
    "Reasoning requested",
    "Reasoning confirmed",
    "Session ID",
    "Last activity",
  ])
    expect(field(name)).toBe("unknown");
  expect(screen.queryByRole("button")).toBeNull();
});

it("shows reported values, the branch, the session and copies long values", async () => {
  const writeText = vi.fn(async () => undefined);
  stubClipboard(writeText);
  renderConsole(
    <ConsoleMetadata
      view={sessionView({
        workspace: {
          directory: "/srv/workspaces/pages",
          git: { state: "branch", branch: "feature/console" },
          checkedAt: "2026-10-26T00:00:00.000Z",
        },
        model: {
          requestedModel: { ...REPORTED, value: "gpt-5" },
          confirmedModel: { ...REPORTED, value: "gpt-5-codex" },
          requestedReasoning: { ...REPORTED, value: "high" },
          confirmedReasoning: { ...REPORTED, value: null },
        },
      })}
      record={cliSession({ sessionId: "thread-42" })}
      lastActivity="26.10.2026, 10:00:00"
    />,
  );
  expect(field("Model requested")).toBe("gpt-5");
  expect(field("Model confirmed")).toBe("gpt-5-codex");
  expect(field("Reasoning requested")).toBe("high");
  expect(field("Reasoning confirmed")).toBe("unknown");
  expect(field("Last activity")).toBe("26.10.2026, 10:00:00");
  expect(screen.getByTitle("/srv/workspaces/pages")).toBeTruthy();
  expect(screen.getByTitle("feature/console")).toBeTruthy();
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Copy /srv/workspaces/pages" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy thread-42" }));
    await Promise.resolve();
  });
  expect(writeText.mock.calls).toEqual([
    ["/srv/workspaces/pages"],
    ["thread-42"],
  ]);
});

it("ignores a refused clipboard and a browser without one", async () => {
  const writeText = vi.fn(async () => {
    throw new Error("Clipboard denied");
  });
  stubClipboard(writeText);
  const { rerender } = renderConsole(
    withGit({ state: "branch", branch: "main" }),
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Copy main" }));
    await Promise.resolve();
  });
  expect(writeText).toHaveBeenCalledWith("main");
  Reflect.deleteProperty(navigator, "clipboard");
  rerender(withGit({ state: "branch", branch: "main" }));
  fireEvent.click(screen.getByRole("button", { name: "Copy main" }));
  expect(field("Git branch")).toBe("main");
});

it("names a detached head by its short commit and other Git states by their text", () => {
  const { rerender } = renderConsole(
    withGit({ state: "detached", commit: "0123456789abcdef0123" }),
  );
  expect(field("Git branch")).toBe("Detached HEAD at 0123456789ab");
  rerender(withGit({ state: "no_repository" }));
  expect(field("Git branch")).toBe("No Git repository");
  rerender(withGit({ state: "unreadable" }));
  expect(field("Git branch")).toBe("Git state unreadable");
});
