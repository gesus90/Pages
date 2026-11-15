import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { AntigravityUsageSection } from "@/app/components/agents/plans/plan-agent-console/antigravity-usage-section";

import { renderConsole, sessionView } from "./console-fixture";

import type { AntigravityUsageTotal } from "@/definition/AgentSessionPricing";

afterEach(cleanup);

function total(
  overrides: Partial<AntigravityUsageTotal> = {},
): AntigravityUsageTotal {
  return {
    turns: 1,
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 120,
    reasoningTokens: null,
    inputIncludesCache: null,
    isPartial: true,
    amountUsd: 0.00014,
    priceAsOf: ["2026-11-15T12:00:00.000Z"],
    gaps: [],
    ...overrides,
  };
}

it("separates captured reference values from subscription charges and unknown reasoning", () => {
  renderConsole(
    <AntigravityUsageSection
      view={sessionView({
        provider: "antigravity",
        antigravity: { step: total(), run: total({ amountUsd: 0.00028 }) },
      })}
    />,
  );
  expect(screen.getByText(/Subscription charges: unknown/)).toBeTruthy();
  expect(screen.getByText("$0.00014")).toBeTruthy();
  expect(screen.getByText("$0.00028")).toBeTruthy();
  const reasoning = screen.getAllByText("Reasoning")[0]?.parentElement;
  if (!reasoning) throw new Error("Reasoning fact missing");
  expect(within(reasoning).getByText("unknown")).toBeTruthy();
  expect(screen.getAllByText(/Incomplete usage/)).toHaveLength(2);
});

it("shows missing data and prices explicitly and leaves other providers without the section", () => {
  const view = sessionView({
    provider: "antigravity",
    antigravity: {
      step: total({ amountUsd: null, gaps: ["tokens", "price"] }),
      run: total({ amountUsd: null, gaps: ["attempt"] }),
    },
  });
  const rendered = renderConsole(<AntigravityUsageSection view={view} />);
  expect(
    screen.getByText("Required usage counts are missing or invalid."),
  ).toBeTruthy();
  expect(screen.getByText("Required prices are missing.")).toBeTruthy();
  expect(
    screen.getByText("At least one attempt has no usage report."),
  ).toBeTruthy();
  expect(screen.queryByText("$0")).toBeNull();
  rendered.rerender(<AntigravityUsageSection view={sessionView()} />);
  expect(screen.queryByText("Antigravity · captured usage")).toBeNull();
});
