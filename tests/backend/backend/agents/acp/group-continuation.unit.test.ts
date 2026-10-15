import { expect, it, vi } from "vitest";

import { startCodexSession } from "./acp-harness";
import { groupFixture } from "../../service/agents/page73-group-fixture";

vi.mock("@/backend/agents/cli/CliProcessScan", () => ({
  RUN_INSTANCE_VARIABLE: "PAGES_RUN_INSTANCE",
  endTaggedProcesses: vi.fn(async () => ({ found: 0, remaining: 0 })),
}));

it("refuses an adapter that changes the effective runtime mode during a turn", async () => {
  const world = startCodexSession(
    {
      turn: async (turn) => {
        await turn.update({
          sessionUpdate: "current_mode_update",
          currentModeId: "agent-full-access",
        });
        return "end_turn";
      },
    },
    { hasMcp: false },
  );
  const result = await world.session.turn;
  expect(result).toMatchObject({
    failure: "failed",
    errorCode: "plan_context_changed",
  });
  expect(result.events).toContain("runtime configuration changed: sessionMode");
  await world.session.close();
});

it("sends two distinct step prompts on one native session and resets the turn output", async () => {
  let count = 0;
  const world = startCodexSession(
    {
      turn: async (turn) => {
        count += 1;
        await turn.update({
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: count === 1 ? "FIRST secret" : "SECOND from context",
          },
        });
        return "end_turn";
      },
    },
    { hasMcp: false },
  );
  const fixture = await groupFixture();
  const first = await world.session.turn;
  const prepared = await fixture.base.start.prepare(
    fixture.base.run,
    fixture.snapshot,
    fixture.snapshot.steps[1] ?? fixture.base.step,
  );
  const identified = vi.fn();
  const second = await world.session.next(
    { ...prepared.input, prompt: "Only the second instruction" },
    new AbortController().signal,
    { started: vi.fn(), identified },
  );
  expect(first.output).toBe("FIRST secret");
  expect(second.output).toBe("SECOND from context");
  expect(second.sessionId).toBe(first.sessionId);
  expect(identified).toHaveBeenCalledWith(first.sessionId);
  expect(
    world.calls.filter((call) => call.method === "session/new"),
  ).toHaveLength(1);
  const prompts = world.calls.filter(
    (call) => call.method === "session/prompt",
  );
  expect(prompts).toHaveLength(2);
  expect(prompts[1]?.params).toMatchObject({
    sessionId: first.sessionId,
    prompt: [{ type: "text", text: "Only the second instruction" }],
  });
  expect(
    second.events.some((event) => event.includes("continue session")),
  ).toBe(true);
  await world.session.close();
});
