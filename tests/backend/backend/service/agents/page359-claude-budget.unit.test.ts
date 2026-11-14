import { AgentActivityRepository } from "@/backend/database/repositories/employee/AgentActivityRepository";
import { expect, it, vi } from "vitest";

import { AgentEmployeeRepository } from "@/backend/database/repositories/employee/AgentEmployeeRepository";
import { readAgentEmployeeInput } from "@/backend/service/employee/AgentEmployeeInput";
import { ClaudeMonthlyBudget } from "@/backend/service/agents/sessions/ClaudeMonthlyBudget";
import { ClaudeMonthlyBudgetRepository } from "@/backend/database/repositories/agent/ClaudeMonthlyBudgetRepository";

it("uses the stored calculated cost for UTC month limits, including subscription spend", async () => {
  const repository = {
    limit: vi.fn(async () => 0.001),
    spent: vi.fn(async () => ({ known: 0.0011, unknownSessions: 0 })),
  };
  const budget = new ClaudeMonthlyBudget(
    repository,
    () => new Date("2026-11-14T00:00:00Z"),
  );
  await expect(budget.require("agent")).rejects.toMatchObject({
    code: "claude_monthly_cost_limit",
  });
  expect(repository.spent).toHaveBeenCalledWith(
    "agent",
    "2026-11-01T00:00:00.000Z",
  );
  repository.spent.mockResolvedValue({ known: 0.00055, unknownSessions: 1 });
  await expect(budget.require("agent")).resolves.toBeUndefined();
});

it("does not apply a monthly budget to people or agents that have no Claude limit", async () => {
  const repository = { limit: vi.fn(async () => null), spent: vi.fn() };
  await new ClaudeMonthlyBudget(repository).require("person");
  expect(repository.spent).not.toHaveBeenCalled();
});

it("reads exactly the priced plan rows for the executing account rather than adapter cumulative costs", async () => {
  const query = vi.fn().mockResolvedValueOnce([[0.0011, 1]]);
  const repository = new ClaudeMonthlyBudgetRepository({ query });
  expect(await repository.spent("agent", "2026-11-01T00:00:00.000Z")).toEqual({
    known: 0.0011,
    unknownSessions: 1,
  });
  expect(query.mock.calls[0]?.[0]).toContain(
    "usage.claude_accounting::jsonb ->> 'costUsd'",
  );
  expect(query.mock.calls[0]?.[1]).toEqual({
    user_id: "agent",
    since: "2026-11-01T00:00:00.000Z",
  });
});

it("saves a Claude budget and preserves it when an older client omits that field", async () => {
  const query = vi.fn(async () => [["agent"]]);
  const execute = vi.fn(async () => undefined);
  const repository = new AgentEmployeeRepository({ query, execute });
  const fields = {
    displayName: "Claude",
    username: "claude",
    position: null,
    roleId: "member",
    connectionId: "claude",
    model: "claude-haiku-5-5",
    reasoningEffort: "low",
    access: "read_only",
    claudeMonthlyCostLimitUsd: "0.001",
  };
  const input = readAgentEmployeeInput(fields);
  expect(input.settings.claudeMonthlyCostLimitUsd).toBe(0.001);
  const change = {
    connectionId: "claude",
    model: "claude-haiku-5-5",
    reasoningEffort: "low",
    access: input.settings.access,
    soul: "",
    instructions: "",
    isLearningEnabled: false,
    voiceId: null,
    voiceSpeedTenths: 10,
    memoryCharacters: 6000,
    dreamCharacters: 6000,
  };
  await repository.update(
    "agent",
    { ...change, claudeMonthlyCostLimitUsd: 0.001 },
    1,
  );
  expect(query.mock.calls[0]?.[1]).toMatchObject({
    has_claude_limit: true,
    claude_monthly_cost_limit: 0.001,
  });
  await repository.update("agent", change, 2);
  expect(query.mock.calls[1]?.[1]).toMatchObject({ has_claude_limit: false });
  expect(() =>
    readAgentEmployeeInput({ ...fields, claudeMonthlyCostLimitUsd: -1 }),
  ).toThrow();
});

it("adds the same calculated plan costs to the agent account's existing monthly display", async () => {
  const query = vi
    .fn()
    .mockResolvedValueOnce([[1, 2]])
    .mockResolvedValueOnce([[0.00055, 1]]);
  const repository = new AgentActivityRepository({
    query,
    execute: async () => undefined,
  });
  expect(
    await repository.costSince("agent", "2026-11-01T00:00:00.000Z"),
  ).toEqual({ known: 1.00055, unknownSessions: 3 });
});
