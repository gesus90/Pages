import { fireEvent, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { ConsoleUsage } from "@/app/components/agents/plans/plan-agent-console/console-usage";

import { renderConsole, sessionView, tokenUsage } from "./console-fixture";

import type {
  AgentSessionContextUsage,
  AgentSessionUsageTotal,
} from "@/definition/AgentSessionJournal";

const UNAVAILABLE =
  "Context occupancy not available: the adapter has not reported both occupancy and window size.";

function context(
  contextUsed: number | null,
  contextLimit: number | null,
): AgentSessionContextUsage {
  return {
    contextUsed,
    contextLimit,
    percent: null,
    source: "acp_usage_update",
    reportedAt: null,
  };
}

function total(
  models: readonly string[],
  overrides: Partial<AgentSessionUsageTotal> = {},
): AgentSessionUsageTotal {
  return {
    ...tokenUsage(),
    provider: "codex_cli",
    turns: 2,
    models,
    ...overrides,
  };
}

function cell(name: string): HTMLElement {
  const terms = screen.getAllByText(name, { selector: "dt" });
  const term = terms.at(-1);
  if (!term) throw new Error(`No ${name} cell`);
  return term;
}

it("shows a known occupancy as meter, capped at the full window", () => {
  const { rerender } = renderConsole(
    <ConsoleUsage view={sessionView({ context: context(50_000, 200_000) })} />,
  );
  const meter = screen.getByRole("meter", {
    name: "Context window occupancy",
  });
  expect(meter.getAttribute("aria-valuenow")).toBe("25");
  expect(screen.getByText(/of 200K tokens in context \(25 %\)/)).toBeTruthy();
  rerender(
    <ConsoleUsage view={sessionView({ context: context(300_000, 200_000) })} />,
  );
  expect(screen.getByRole("meter").getAttribute("aria-valuenow")).toBe("100");
});

it("estimates no occupancy from a missing or invalid count", () => {
  const { rerender } = renderConsole(
    <ConsoleUsage view={sessionView({ context: context(null, 200_000) })} />,
  );
  expect(screen.getByText(UNAVAILABLE)).toBeTruthy();
  for (const [used, limit] of [
    [10, null],
    [10, 0],
    [-1, 100],
  ] as const) {
    rerender(
      <ConsoleUsage view={sessionView({ context: context(used, limit) })} />,
    );
    expect(screen.queryByRole("meter")).toBeNull();
    expect(screen.getByText(UNAVAILABLE)).toBeTruthy();
  }
});

it("shows this session's sums by default and the whole run on request, labelled by their models", () => {
  renderConsole(
    <ConsoleUsage
      view={sessionView({
        totals: [total(["gpt-5", "gpt-5-codex"])],
        runTotals: [
          total([], {
            inputTokens: null,
            inputIncludesCache: false,
            isPartial: true,
          }),
        ],
      })}
    />,
  );
  expect(screen.getByText("gpt-5, gpt-5-codex")).toBeTruthy();
  expect(cell("In").getAttribute("title")).toBe(
    "Input tokens include the cache reads.",
  );
  expect(cell("In").nextElementSibling?.textContent).toBe("1.2K");
  expect(cell("Out").getAttribute("title")).toBeNull();
  expect(cell("Cache Read").nextElementSibling?.textContent).toBe("–");
  fireEvent.click(screen.getByRole("button", { name: "Whole run" }));
  expect(screen.queryByText("gpt-5, gpt-5-codex")).toBeNull();
  expect(cell("In").getAttribute("title")).toBe(
    "Input tokens exclude the cache reads; they are counted separately.",
  );
  expect(cell("In").nextElementSibling?.textContent).toBe("–");
  expect(
    screen.getByText(
      "Partial: a turn reported no count, or the adapter counts only part of the work.",
    ),
  ).toBeTruthy();
});

it("shows the last turn with its confirmed model and says when nothing was counted", () => {
  const turn = {
    ...tokenUsage({ inputIncludesCache: null }),
    attemptId: "attempt-page161",
    provider: "codex_cli" as const,
    reportedAt: "2026-10-26T00:00:00.000Z",
  };
  const { rerender } = renderConsole(
    <ConsoleUsage
      view={sessionView({
        turns: [
          { ...turn, turn: 1, model: "gpt-5" },
          { ...turn, turn: 2, model: "gpt-5-codex" },
        ],
      })}
    />,
  );
  expect(screen.getByText("No token counts reported yet.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Last turn" }));
  expect(screen.getByText("gpt-5-codex")).toBeTruthy();
  expect(screen.queryByText("gpt-5")).toBeNull();
  expect(cell("In").getAttribute("title")).toBe(
    "Whether input tokens include cache reads is not verified for this adapter.",
  );
  rerender(
    <ConsoleUsage
      view={sessionView({ turns: [{ ...turn, turn: 1, model: null }] })}
    />,
  );
  expect(screen.getAllByText("In", { selector: "dt" })).toHaveLength(1);
  rerender(<ConsoleUsage view={sessionView()} />);
  expect(screen.getByText("No token counts reported yet.")).toBeTruthy();
});
