import { expect, it, vi } from "vitest";

import { runRecipe } from "@/backend/service/employee/AgentRecipeRunner";

import { recipe } from "./page378-recipe-fixture";

import type { AgentRecipeStepRunner } from "@/definition/AgentDreaming";

type Call = Parameters<AgentRecipeStepRunner["call"]>;

/** A runner whose tools answer with the prepared results in order. */
function runner(
  answers: Record<string, string | { error: string }>,
  offers: Partial<Record<string, "ok" | "unknown" | "confirmation">> = {},
): { runner: AgentRecipeStepRunner; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    runner: {
      offers: (tool) => offers[tool] ?? "ok",
      call: vi.fn<AgentRecipeStepRunner["call"]>(async (...call) => {
        calls.push(call);
        const answer = answers[call[0]];
        if (answer === undefined)
          return { isOk: false, error: "FAILED", result: null };
        return typeof answer === "string"
          ? { isOk: true, result: answer }
          : { isOk: false, error: answer.error, result: null };
      }),
    },
  };
}

it("runs the whole chain of tools in one call, with parameters and the results of earlier steps", async () => {
  const { runner: steps, calls } = runner({
    tickets_search: JSON.stringify({ statuses: ["todo"] }),
    tickets_create: JSON.stringify({ id: "t-9" }),
    tickets_read: JSON.stringify({ id: "t-9", title: "Neu" }),
  });
  const outcome = await runRecipe(recipe(), { projekt: "p-1" }, steps);

  expect(outcome).toMatchObject({
    status: "done",
    result: JSON.stringify({ id: "t-9", title: "Neu" }),
  });
  expect(calls.map((call) => call[0])).toEqual([
    "tickets_search",
    "tickets_create",
    "tickets_read",
  ]);
  expect(calls[0]?.[1]).toEqual({ projectId: "p-1" });
  // The third step reads the ticket the second one created.
  expect(calls[2]?.[1]).toEqual({ ticketId: "t-9" });
  if (outcome.status !== "done") return;
  expect(
    outcome.steps.map((step) => [step.nr, step.werkzeug, step.ok]),
  ).toEqual([
    [1, "tickets_search", true],
    [2, "tickets_create", true],
    [3, "tickets_read", true],
  ]);
});

it("asks for the missing parameters before it calls any tool", async () => {
  const { runner: steps, calls } = runner({});
  expect(await runRecipe(recipe(), {}, steps)).toEqual({
    status: "missing",
    parameters: ["projekt"],
  });
  expect(calls).toHaveLength(0);
});

it("stops at a step that needs the normal confirmation and calls nothing after it", async () => {
  const deleting = recipe({
    steps: [
      { tool: "tickets_read", input: { ticketId: "t-1" }, note: "" },
      { tool: "tickets_delete", input: { ticketId: "t-1" }, note: "" },
      { tool: "tickets_read", input: { ticketId: "t-2" }, note: "" },
    ],
    parameters: [],
  });
  const { runner: steps, calls } = runner(
    { tickets_read: "{}", tickets_delete: "{}" },
    {
      tickets_delete: "confirmation",
    },
  );
  const outcome = await runRecipe(deleting, {}, steps);
  expect(outcome).toMatchObject({
    status: "confirmation",
    step: 2,
    tool: "tickets_delete",
  });
  expect(calls.map((call) => call[0])).toEqual(["tickets_read"]);
});

it("stops when a tool itself asks for the confirmation, and when the input carries one", async () => {
  const confirming = recipe({
    parameters: [],
    steps: [{ tool: "storage_trash", input: { ref: "a" }, note: "" }],
  });
  const asked = runner({ storage_trash: { error: "CONFIRMATION_REQUIRED" } });
  expect(await runRecipe(confirming, {}, asked.runner)).toMatchObject({
    status: "confirmation",
    step: 1,
  });
  const forced = recipe({
    parameters: [],
    steps: [{ tool: "tickets_read", input: { confirmed: true }, note: "" }],
  });
  const none = runner({ tickets_read: "{}" });
  expect(await runRecipe(forced, {}, none.runner)).toMatchObject({
    status: "confirmation",
  });
  expect(none.calls).toHaveLength(0);
});

it("fails at the first step that fails, a tool the session does not offer or a value that is missing", async () => {
  const failing = runner({
    tickets_search: "{}",
    tickets_create: { error: "FORBIDDEN" },
  });
  expect(
    await runRecipe(recipe(), { projekt: "p" }, failing.runner),
  ).toMatchObject({
    status: "failed",
    step: 2,
    tool: "tickets_create",
    error: "FORBIDDEN",
  });
  expect(failing.calls.map((call) => call[0])).toEqual([
    "tickets_search",
    "tickets_create",
  ]);

  const gone = runner({}, { tickets_search: "unknown" });
  expect(
    await runRecipe(recipe(), { projekt: "p" }, gone.runner),
  ).toMatchObject({
    status: "failed",
    step: 1,
    error: "TOOL_UNAVAILABLE",
  });

  // Step 1 answers without the id step 3 needs.
  const noValue = runner({
    tickets_search: "{}",
    tickets_create: JSON.stringify({ other: 1 }),
    tickets_read: "{}",
  });
  expect(
    await runRecipe(recipe(), { projekt: "p" }, noValue.runner),
  ).toMatchObject({
    status: "failed",
    step: 3,
    error: "MISSING_VALUE",
  });
});
