import { expect, it, vi } from "vitest";

import { startAcpSession, startCodexSession } from "./acp-harness";
import { groupFixture } from "../../service/agents/page73-group-fixture";

vi.mock("@/backend/agents/cli/CliProcessScan", () => ({
  RUN_INSTANCE_VARIABLE: "PAGES_RUN_INSTANCE",
  readServerScope: async () => ({ earliestStart: 0 }),
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

it("reapplies Antigravity model and effort before each group turn", async () => {
  const model = "gemini-3.8-flash";
  const world = startAcpSession(
    {
      agentInfo: { name: "antigravity-acp", version: "1.4.4" },
      models: [model],
      turn: async (turn) => {
        await turn.update({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "READY" },
        });
        return "end_turn";
      },
    },
    { provider: "antigravity", hasMcp: false, model, reasoningEffort: "low" },
  );
  expect((await world.session.turn).failure).toBeNull();
  const fixture = await groupFixture();
  const prepared = await fixture.base.start.prepare(
    fixture.base.run,
    fixture.snapshot,
    fixture.snapshot.steps[1] ?? fixture.base.step,
  );
  const result = await world.session.next(
    {
      ...prepared.input,
      agent: { ...prepared.input.agent, model, reasoningEffort: "low" },
    },
    new AbortController().signal,
    { started: vi.fn(), identified: vi.fn() },
  );
  expect(result.failure).toBeNull();
  expect(
    world.calls
      .filter((call) => call.method === "session/set_config_option")
      .map((call) => call.params),
  ).toMatchObject([
    { configId: "model", value: model },
    { configId: "thinking_level", value: "low" },
    { configId: "model", value: model },
    { configId: "thinking_level", value: "low" },
  ]);
  await world.session.close();
});

it("fails a turn when the official adapter reports that Pages MCP failed to initialize", async () => {
  const model = "gemini-3.8-flash";
  const world = startAcpSession(
    {
      agentInfo: { name: "antigravity-acp", version: "1.4.4" },
      models: [model],
      turn: async (turn) => {
        await turn.update({
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: "The MCP server 'pages' failed to initialize: synthetic failure",
          },
        });
        return "end_turn";
      },
    },
    { provider: "antigravity", model, reasoningEffort: "low" },
  );
  expect(await world.session.turn).toMatchObject({
    failure: "failed",
    errorCode: "plan_mcp_unavailable",
  });
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
