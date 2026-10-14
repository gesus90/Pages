import { afterEach, expect, it, vi } from "vitest";

import { AgentPlanExecution } from "@/backend/agents/AgentPlanExecution";
import { AgentPlanStepRunner } from "@/backend/service/agents/AgentPlanStepRunner";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import { AgentError } from "@/backend/error/AgentErrors";
import {
  DEFAULT_AGENT_RUN_OPTIONS,
  emptyAgentConfiguration,
} from "@/definition/AgentConfiguration";

import { parameterRunFixture } from "./page55-run-fixture";

import type { TextExecution } from "@/backend/agents/TextExecution";
import type { ParameterRunFixture } from "./page55-run-fixture";

afterEach(() => vi.useRealTimers());

function runner(
  fixture: ParameterRunFixture,
  api: TextExecution,
): AgentPlanStepRunner {
  const execution = new AgentPlanExecution(
    api,
    { open: vi.fn() },
    new AgentOperationRegistry(),
    { requireUser: async () => {} },
  );
  return new AgentPlanStepRunner({
    start: fixture.start,
    execution,
    tasks: { checklist: vi.fn() },
    access: { grant: vi.fn(), revoke: async () => 0 },
  });
}

it("sends the entire resolved AGENT.md instruction, including repeated ticket placeholders, through the execution boundary", async () => {
  const fixture = await parameterRunFixture({
    ...emptyAgentConfiguration(),
    markdown: "BEGIN\n{{ticketID}}\n{{count}}\n{{ticketID}}\nEND",
    parameters: [
      {
        name: "ticketID",
        type: "ticket",
        description: "",
        isRequired: true,
        defaultValue: { type: "ticket", ticketId: "ticket-id" },
      },
      {
        name: "count",
        type: "number",
        description: "",
        isRequired: true,
        defaultValue: { type: "number", number: 42 },
      },
    ],
  });
  const run = vi.fn<TextExecution["run"]>(async () => "Completed");
  const result = await runner(fixture, { run }).run(
    fixture.run,
    fixture.snapshot,
    fixture.step,
    { signal: new AbortController().signal, save: async () => {} },
  );
  expect(result.status).toBe("succeeded");
  expect(run.mock.calls[0]?.[0].prompt).toBe(
    `${fixture.step.prepared.parameters.markdown}\n\nAdditional instruction`,
  );
  expect(run.mock.calls[0]?.[0].prompt.match(/Criterion/g)).toHaveLength(2);
});

it("allows timeout zero to exceed the old API limit and the maximum configurable timeout before completing", async () => {
  vi.useFakeTimers();
  const timeout = vi.spyOn(AbortSignal, "timeout");
  const fixture = await parameterRunFixture();
  const signals: AbortSignal[] = [];
  let finish: ((output: string) => void) | undefined;
  const request = runner(fixture, {
    run: async (input, requestSignal) => {
      signals.push(requestSignal);
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  const completion = request.run(fixture.run, fixture.snapshot, fixture.step, {
    signal: new AbortController().signal,
    save: async () => {},
  });
  await vi.waitFor(() => expect(finish).toBeDefined());
  await vi.advanceTimersByTimeAsync(121 * 60_000);
  expect(timeout).not.toHaveBeenCalled();
  expect(signals[0]?.aborted).toBe(false);
  finish?.("Completed after long work");
  expect((await completion).status).toBe("succeeded");
});

it("aborts exactly at a positive deadline and reports a failed run with the timeout cause", async () => {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
    const controller = new AbortController();
    setTimeout(
      () => controller.abort(new DOMException("Timeout", "TimeoutError")),
      milliseconds,
    );
    return controller.signal;
  });
  const fixture = await parameterRunFixture({
    ...emptyAgentConfiguration(),
    run: { ...DEFAULT_AGENT_RUN_OPTIONS, timeoutMinutes: 1 },
  });
  let signal: AbortSignal | undefined;
  const run = vi.fn<TextExecution["run"]>(async (input, requestSignal) => {
    signal = requestSignal;
    return new Promise((resolve, reject) =>
      requestSignal.addEventListener(
        "abort",
        () => reject(new Error("Provider interrupted")),
        { once: true },
      ),
    );
  });
  const completion = runner(fixture, { run }).run(
    fixture.run,
    fixture.snapshot,
    fixture.step,
    { signal: new AbortController().signal, save: async () => {} },
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(run).toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(59_999);
  expect(signal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  const result = await completion;
  expect(signal?.aborted).toBe(true);
  expect(result).toMatchObject({
    status: "failed",
    error: "timeout",
    session: { resultCode: -1 },
  });
});

it("starts no execution when preparation reports a missing value or inaccessible ticket", async () => {
  const fixture = await parameterRunFixture();
  const run = vi.fn<TextExecution["run"]>();
  for (const code of [
    "parameter_required",
    "parameter_ticket_unavailable",
    "parameter_number_invalid",
    "plan_placeholder_unresolved",
  ] as const) {
    vi.spyOn(fixture.start, "prepare").mockRejectedValueOnce(
      new AgentError(code),
    );
    const result = await runner(fixture, { run }).run(
      fixture.run,
      fixture.snapshot,
      fixture.step,
      { signal: new AbortController().signal, save: async () => {} },
    );
    expect(result).toMatchObject({ status: "failed", error: code });
  }
  expect(run).not.toHaveBeenCalled();
});

it("rechecks ticket access at the provider boundary and starts no request after access was revoked", async () => {
  const fixture = await parameterRunFixture({
    ...emptyAgentConfiguration(),
    markdown: "{{ticketID}}",
    parameters: [
      {
        name: "ticketID",
        type: "ticket",
        description: "",
        isRequired: true,
        defaultValue: { type: "ticket", ticketId: "ticket-id" },
      },
    ],
  });
  vi.spyOn(fixture.parameters, "prepare")
    .mockResolvedValueOnce(fixture.step.prepared)
    .mockRejectedValueOnce(new AgentError("parameter_ticket_unavailable"));
  const run = vi.fn<TextExecution["run"]>();
  const result = await runner(fixture, { run }).run(
    fixture.run,
    fixture.snapshot,
    fixture.step,
    { signal: new AbortController().signal, save: async () => {} },
  );
  expect(result).toMatchObject({
    status: "failed",
    error: "parameter_ticket_unavailable",
  });
  expect(run).not.toHaveBeenCalled();
});
