import { agent, client, methods } from "@agentclientprotocol/sdk";
import { afterEach, expect, it, vi } from "vitest";

import { createAcpSessionState } from "@/backend/agents/acp/AcpEvents";
import { AcpMcpReadiness } from "@/backend/agents/acp/AcpMcpReadiness";

import type { AcpSessionState } from "@/backend/agents/acp/AcpEvents";

/** One scripted answer to `/mcp`: the chunks to send, then an optional gate. */
interface McpAnswer {
  readonly chunks: readonly string[];
  readonly gate?: Promise<void>;
}

afterEach(() => {
  vi.useRealTimers();
});

function listing(group: string): string {
  return `**${group}**\n- \`pages\`: 2 tools\n`;
}

function connect(answers: McpAnswer[]): {
  readonly readiness: AcpMcpReadiness;
  readonly state: AcpSessionState;
  readonly prompts: string[];
} {
  const state = createAcpSessionState();
  const prompts: string[] = [];
  const adapter = agent({ name: "fake" }).onRequest(
    methods.agent.session.prompt,
    async (context) => {
      const [block] = context.params.prompt;
      prompts.push(block?.type === "text" ? block.text : "");
      const answer = answers.shift() ?? { chunks: [listing("Connected")] };
      for (const text of answer.chunks)
        await context.client.notify(methods.client.session.update, {
          sessionId: context.params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text },
          },
        });
      await answer.gate;
      return { stopReason: "end_turn" };
    },
  );
  let readiness: AcpMcpReadiness | null = null;
  const connection = client({ name: "pages" })
    .onNotification(methods.client.session.update, (notification) => {
      readiness?.receive(notification.params.update);
    })
    .connect(adapter);
  readiness = new AcpMcpReadiness(connection, state);
  return { readiness, state, prompts };
}

it("refuses at once when the Pages MCP server failed to start", async () => {
  const { readiness, state, prompts } = connect([]);
  state.isMcpUnavailable = true;

  await expect(readiness.require("s-1", true)).rejects.toMatchObject({
    code: "plan_mcp_unavailable",
  });
  expect(prompts).toEqual([]);
});

it("does not ask an adapter without a verified status command", async () => {
  const { readiness, prompts } = connect([]);

  await readiness.require("s-1", false);

  expect(prompts).toEqual([]);
});

it("returns once the server is listed as connected", async () => {
  const { readiness, state, prompts } = connect([
    { chunks: ["**Conn", "ected**\n- `pages`"] },
  ]);

  await readiness.require("s-1", true);

  expect(prompts).toEqual(["/mcp"]);
  expect(state.events).toEqual(["mcp pages connected"]);
});

it("returns for a server the listing does not name", async () => {
  const { readiness, state } = connect([{ chunks: ["**MCP servers:** 0"] }]);

  await readiness.require("s-1", true);

  expect(state.events).toEqual(["mcp pages unknown"]);
});

it("fails when the server is listed as failed", async () => {
  const { readiness, state } = connect([{ chunks: [listing("Failed")] }]);

  await expect(readiness.require("s-1", true)).rejects.toMatchObject({
    code: "plan_mcp_unavailable",
  });
  expect(state.events).toEqual(["mcp pages failed"]);
});

it("polls while the server connects and notes only changes", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
  const { readiness, state, prompts } = connect([
    { chunks: [listing("Connecting")] },
    { chunks: [listing("Connecting")] },
    { chunks: [listing("Connected")] },
  ]);

  const required = readiness.require("s-1", true);
  await vi.advanceTimersByTimeAsync(1_000);
  await required;

  expect(prompts).toHaveLength(3);
  expect(state.events).toEqual(["mcp pages connecting", "mcp pages connected"]);
});

it("gives up when the server is still connecting after the wait", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
  const answers = Array.from({ length: 60 }, () => ({
    chunks: [listing("Connecting")],
  }));
  const { readiness } = connect(answers);

  const required = readiness.require("s-1", true);
  const rejected = expect(required).rejects.toMatchObject({
    code: "plan_mcp_unavailable",
  });
  await vi.advanceTimersByTimeAsync(21_000);
  await rejected;
});

it("claims only updates that arrive while its command runs", () => {
  const { readiness } = connect([]);

  expect(
    readiness.receive({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "model output" },
    }),
  ).toBe(false);
});

it("swallows non-text updates of its own command", async () => {
  const state = createAcpSessionState();
  const adapter = agent({ name: "fake" }).onRequest(
    methods.agent.session.prompt,
    async (context) => {
      await context.client.notify(methods.client.session.update, {
        sessionId: context.params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "image", data: "AA==", mimeType: "image/png" },
        },
      });
      await context.client.notify(methods.client.session.update, {
        sessionId: context.params.sessionId,
        update: { sessionUpdate: "current_mode_update", currentModeId: "ask" },
      });
      return { stopReason: "end_turn" };
    },
  );
  const claimed: boolean[] = [];
  let readiness: AcpMcpReadiness | null = null;
  const connection = client({ name: "pages" })
    .onNotification(methods.client.session.update, (notification) => {
      if (readiness)
        claimed.push(readiness.receive(notification.params.update));
    })
    .connect(adapter);
  readiness = new AcpMcpReadiness(connection, state);

  await readiness.require("s-1", true);

  expect(claimed).toEqual([true, true]);
  expect(state.events).toEqual(["mcp pages unknown"]);
});

it("reads an empty listing when an overlapping command already finished", async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { readiness, state, prompts } = connect([
    { chunks: [], gate },
    { chunks: [listing("Connected")] },
  ]);

  const first = readiness.require("s-1", true);
  await vi.waitFor(() => {
    expect(prompts).toHaveLength(1);
  });
  await readiness.require("s-1", true);
  release();
  await first;

  expect(state.events).toEqual(["mcp pages connected", "mcp pages unknown"]);
});
