import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { bracketedPaste } from "@/backend/agents/terminal/TerminalInputs";
import { TerminalTurns } from "@/backend/agents/terminal/TerminalTurns";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

it("ends a completed turn after the grace without a new prompt", async () => {
  const turns = new TerminalTurns();
  const outcome = turns.begin();
  turns.ended({ status: "completed", output: "done" });
  expect(turns.isRunning).toBe(true);
  await vi.advanceTimersByTimeAsync(1_500);
  await expect(outcome).resolves.toEqual({
    failure: null,
    errorCode: null,
    output: "done",
  });
});

it("keeps the turn when a typed prompt starts right after the reported end", async () => {
  const turns = new TerminalTurns();
  const outcome = turns.begin();
  turns.ended({ status: "completed", output: "first" });
  await vi.advanceTimersByTimeAsync(500);
  turns.started();
  await vi.advanceTimersByTimeAsync(5_000);
  expect(turns.isRunning).toBe(true);
  turns.ended({ status: "completed", output: "second" });
  await vi.advanceTimersByTimeAsync(1_500);
  await expect(outcome).resolves.toMatchObject({ output: "second" });
});

it("waits for a person after an interruption and then ends as cancelled", async () => {
  const turns = new TerminalTurns();
  const outcome = turns.begin();
  turns.ended({ status: "interrupted", output: "" });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(turns.isRunning).toBe(true);
  await vi.advanceTimersByTimeAsync(5 * 60_000);
  await expect(outcome).resolves.toMatchObject({ failure: "cancelled" });
});

it("fails at once for a question or a failed turn", async () => {
  const turns = new TerminalTurns();
  const outcome = turns.begin();
  turns.finish({
    failure: "failed",
    errorCode: "plan_terminal_question",
    output: "",
  });
  await expect(outcome).resolves.toMatchObject({
    failure: "failed",
    errorCode: "plan_terminal_question",
  });
});

it("pastes text as one block that cannot end early", () => {
  expect(bracketedPaste("line 1\nline 2\u001b[201~rm")).toBe(
    "\u001b[200~line 1\rline 2rm\u001b[201~",
  );
});
