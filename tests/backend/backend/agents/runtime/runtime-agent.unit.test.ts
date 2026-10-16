import { RequestContext } from "@mastra/core/request-context";
import { expect, it, vi } from "vitest";
import { z } from "zod";

import { createRuntimeAgent } from "@/backend/agents/runtime/RuntimeAgent";
import { RuntimeToolRegistry } from "@/backend/agents/runtime/RuntimeToolRegistry";

import {
  nativeSession,
  owner,
  resourceWorld,
} from "../../service/agents/page81-resource-fixture";
import { fakeRuntimeModel, runtimeContext, toolModel } from "./runtime-fixture";

import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";

it("generates and streams API-model answers while the only ACP slot is occupied", async () => {
  const world = resourceWorld();
  await world.scheduler.recover();
  const blocker = await world.scheduler.open(
    owner("occupied"),
    new AbortController().signal,
    async () => nativeSession(),
  );
  const { context } = await runtimeContext();
  const provider = fakeRuntimeModel();
  const agent = createRuntimeAgent({
    id: "api",
    name: "API",
    instructions: "Answer",
    model: provider.model,
    context,
  });
  try {
    const savedLeases = world.store.save.mock.calls.length;
    const result = await agent.generate("Hello");
    expect(result.text).toBe("answer");
    expect(result.runId).toBe(context.runId);
    const output = await agent.stream("Stream");
    let text = "";
    for await (const chunk of output.textStream) text += chunk;
    expect(text).toBe("answer");
    expect(provider.calls).toHaveBeenCalledTimes(2);
    expect(provider.calls.mock.calls[0]?.[0].abortSignal?.aborted).toBe(false);
    expect(world.store.save).toHaveBeenCalledTimes(savedLeases);
    expect(world.scheduler.snapshot().active).toHaveLength(1);
    expect(world.scheduler.snapshot().waiting).toEqual([]);
  } finally {
    await blocker.close();
    await world.scheduler.shutdown();
  }
});

it("binds schema-validated native tools to server identity despite forged arguments and metadata", async () => {
  const { context, sessions } = await runtimeContext();
  const execute = vi.fn(
    async (input: { title: string }, execution: RuntimeExecutionContext) => ({
      title: input.title,
      userId: execution.userId,
    }),
  );
  const tools = new RuntimeToolRegistry();
  tools.register({
    id: "pages_read",
    description: "Read Pages",
    inputSchema: z.object({ title: z.string() }),
    outputSchema: z.object({ title: z.string(), userId: z.string() }),
    execute,
  });
  const provider = toolModel("pages_read", {
    title: "native",
    userId: "foreign",
    sessionId: "foreign",
  });
  const agent = createRuntimeAgent({
    id: "tools",
    name: "Tools",
    instructions: "Use tool",
    model: provider.model,
    context,
    tools,
  });
  const result = await agent.generate("Run", {
    requestContext: new RequestContext([["pages.userId", "foreign"]]),
  });
  expect(result.text).toBe("done");
  expect(execute).toHaveBeenCalledOnce();
  expect(execute.mock.calls[0]?.[0]).toEqual({ title: "native" });
  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    userId: context.userId,
    sessionId: context.sessionId,
    runId: context.runId,
  });
  expect(sessions.require.mock.calls.length).toBeGreaterThan(2);
  expect(provider.calls.mock.calls[0]?.[0].tools).toMatchObject([
    {
      name: "pages_read",
      inputSchema: {
        type: "object",
        properties: { title: { type: "string" } },
      },
    },
  ]);
});

it("rejects invalid tool input before dispatching the native handler", async () => {
  const { context } = await runtimeContext();
  const execute = vi.fn(async () => "unexpected");
  const tools = new RuntimeToolRegistry();
  tools.register({
    id: "validated",
    description: "Validated",
    inputSchema: z.object({ count: z.number() }),
    outputSchema: z.string(),
    execute,
  });
  const provider = toolModel("validated", { count: "invalid" });
  const agent = createRuntimeAgent({
    id: "validation",
    name: "Validation",
    instructions: "Validate",
    model: provider.model,
    context,
    tools,
  });
  await agent.generate("Run");
  expect(execute).not.toHaveBeenCalled();
  expect(provider.calls.mock.calls[1]?.[0].prompt).toEqual(
    expect.arrayContaining([expect.objectContaining({ role: "tool" })]),
  );
});

it("suspends a Mastra approval tool before native execution", async () => {
  const { context } = await runtimeContext();
  const execute = vi.fn(async () => "unexpected");
  const tools = new RuntimeToolRegistry();
  tools.register({
    id: "confirm",
    description: "Confirm",
    inputSchema: z.object({}),
    outputSchema: z.string(),
    requireApproval: true,
    execute,
  });
  const agent = createRuntimeAgent({
    id: "approval",
    name: "Approval",
    instructions: "Use tool",
    model: toolModel("confirm", {}).model,
    context,
    tools,
  });
  const result = await agent.generate("Run");
  expect(result.finishReason).toBe("suspended");
  expect(execute).not.toHaveBeenCalled();
});

it("refuses invalid step limits and duplicate or provider-invalid tool IDs", async () => {
  const { context } = await runtimeContext();
  expect(() =>
    createRuntimeAgent({
      id: "invalid",
      name: "Invalid",
      instructions: "Test",
      model: fakeRuntimeModel().model,
      context,
      maxSteps: 0,
    }),
  ).toThrow("maxSteps");
  const tools = new RuntimeToolRegistry();
  const definition = {
    id: "unique",
    description: "Unique",
    inputSchema: z.string(),
    outputSchema: z.string(),
    execute: async (input: string) => input,
  };
  tools.register(definition);
  expect(() => tools.register(definition)).toThrow("already registered");
  expect(() => tools.register({ ...definition, id: "invalid.name" })).toThrow(
    "Invalid runtime tool ID",
  );
});

it("reauthorizes before model access and propagates cancellation without provider calls", async () => {
  const { context, sessions, controller } = await runtimeContext();
  const provider = fakeRuntimeModel();
  const agent = createRuntimeAgent({
    id: "access",
    name: "Access",
    instructions: "Test",
    model: provider.model,
    context,
  });
  sessions.require.mockRejectedValueOnce(new Error("Session revoked"));
  await expect(agent.generate("Denied")).rejects.toThrow("Session revoked");
  controller.abort();
  await expect(agent.generate("Cancelled")).rejects.toThrow();
  expect(provider.calls).not.toHaveBeenCalled();
});

it("validates native tool output and forwards the error to the model", async () => {
  const { context } = await runtimeContext();
  const tools = new RuntimeToolRegistry();
  tools.register({
    id: "output",
    description: "Validate output",
    inputSchema: z.object({}),
    outputSchema: z.string().min(8),
    execute: async () => "short",
  });
  const provider = toolModel("output", {});
  const agent = createRuntimeAgent({
    id: "output",
    name: "Output",
    instructions: "Use tool",
    model: provider.model,
    context,
    tools,
  });
  await agent.generate("Run");
  const toolMessage = provider.calls.mock.calls[1]?.[0].prompt.find(
    (message) => message.role === "tool",
  );
  expect(toolMessage?.content[0]?.output).toMatchObject({
    type: "json",
    value: { error: true },
  });
});

it("emits approval events on fullStream without executing the native tool", async () => {
  const { context } = await runtimeContext();
  const execute = vi.fn(async () => "unexpected");
  const tools = new RuntimeToolRegistry();
  tools.register({
    id: "approve",
    description: "Approve",
    inputSchema: z.object({}),
    outputSchema: z.string(),
    requireApproval: true,
    execute,
  });
  const agent = createRuntimeAgent({
    id: "stream-approval",
    name: "Approval",
    instructions: "Use tool",
    model: toolModel("approve", {}).model,
    context,
    tools,
  });
  const output = await agent.stream("Run");
  const types: string[] = [];
  for await (const chunk of output.fullStream) types.push(chunk.type);
  expect(types).toContain("tool-call-approval");
  expect(execute).not.toHaveBeenCalled();
});

it("does not retry failed provider requests", async () => {
  const { context } = await runtimeContext();
  const provider = fakeRuntimeModel(() => {
    throw new Error("Synthetic provider failure");
  });
  const agent = createRuntimeAgent({
    id: "failure",
    name: "Failure",
    instructions: "Test",
    model: provider.model,
    context,
  });
  await expect(agent.generate("Run")).rejects.toThrow(
    "Synthetic provider failure",
  );
  expect(provider.calls).toHaveBeenCalledOnce();
});
