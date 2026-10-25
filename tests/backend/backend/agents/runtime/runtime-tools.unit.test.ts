import { expect, it, vi } from "vitest";
import { z } from "zod";

import { RuntimeToolRegistry } from "@/backend/agents/runtime/RuntimeToolRegistry";

import { runtimeContext } from "./runtime-fixture";

it("describes the same strict input contract that invoke validates before authorizing", async () => {
  const { context, sessions } = await runtimeContext();
  const tools = new RuntimeToolRegistry();
  const execute = vi.fn(async () => ({ title: "Visible" }));
  tools.register({
    id: "read",
    description: "Read a ticket",
    inputSchema: z.strictObject({ id: z.string() }),
    outputSchema: z.strictObject({ title: z.string() }),
    execute,
  });
  expect(
    tools.describe().map(({ id, description }) => ({ id, description })),
  ).toEqual([{ id: "read", description: "Read a ticket" }]);
  expect(tools.describe()[0]?.inputSchema.additionalProperties).toBe(false);
  const checks = sessions.require.mock.calls.length;
  expect(await tools.invoke("unknown", {}, context)).toBeNull();
  expect(await tools.invoke("read", { id: 5 }, context)).toEqual({
    isValid: false,
    output: null,
  });
  expect(sessions.require).toHaveBeenCalledTimes(checks);
  expect(await tools.invoke("read", { id: "ticket" }, context)).toEqual({
    isValid: true,
    output: { title: "Visible" },
  });
  expect(sessions.require).toHaveBeenCalledTimes(checks + 1);
  expect(execute).toHaveBeenCalledWith({ id: "ticket" }, context);
});

it("refuses revoked access, cancellation and duplicate tools without dispatch", async () => {
  const { context, sessions, controller } = await runtimeContext();
  const tools = new RuntimeToolRegistry();
  const execute = vi.fn(async () => "read");
  const definition = {
    id: "read",
    description: "Read",
    inputSchema: z.strictObject({}),
    outputSchema: z.string(),
    execute,
  };
  tools.register(definition);
  expect(() => tools.register(definition)).toThrow("already registered");
  sessions.require.mockRejectedValueOnce(new Error("Revoked"));
  await expect(tools.invoke("read", {}, context)).rejects.toThrow("Revoked");
  controller.abort();
  await expect(tools.invoke("read", {}, context)).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
});
