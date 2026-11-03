import { expect, it, vi } from "vitest";
import { z } from "zod";

import {
  RuntimeToolDeniedError,
  RuntimeToolRegistry,
} from "@/backend/agents/runtime/RuntimeToolRegistry";

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

it("runs an administrator tool only after the gate admitted that very call", async () => {
  const { context } = await runtimeContext();
  const gate = vi.fn(async () => true);
  const tools = new RuntimeToolRegistry(gate);
  const execute = vi.fn(async () => "done");
  tools.register({
    id: "privileged",
    access: "administrator",
    description: "Privileged",
    inputSchema: z.strictObject({}),
    outputSchema: z.string(),
    execute,
  });

  await tools.invoke("privileged", {}, context);
  await tools.invoke("privileged", {}, context);

  expect(gate).toHaveBeenCalledTimes(2);
  expect(gate).toHaveBeenCalledWith(context, "privileged");
  expect(execute).toHaveBeenCalledTimes(2);
});

it("refuses an administrator tool when the gate denies, fails or is missing", async () => {
  const { context } = await runtimeContext();
  const definition = {
    id: "privileged",
    access: "administrator" as const,
    description: "Privileged",
    inputSchema: z.strictObject({}),
    outputSchema: z.string(),
  };
  const execute = vi.fn(async () => "done");
  const denying = new RuntimeToolRegistry(async () => false);
  const failing = new RuntimeToolRegistry(async () => {
    throw new Error("Accounts unavailable");
  });
  const ungated = new RuntimeToolRegistry();
  for (const registry of [denying, failing, ungated])
    registry.register({ ...definition, execute });

  await expect(
    denying.invoke("privileged", {}, context),
  ).rejects.toBeInstanceOf(RuntimeToolDeniedError);
  await expect(failing.invoke("privileged", {}, context)).rejects.toThrow(
    "Accounts unavailable",
  );
  await expect(
    ungated.invoke("privileged", {}, context),
  ).rejects.toBeInstanceOf(RuntimeToolDeniedError);
  expect(execute).not.toHaveBeenCalled();
});

it("does not ask the gate for an ordinary tool or for refused input", async () => {
  const { context } = await runtimeContext();
  const gate = vi.fn(async () => false);
  const tools = new RuntimeToolRegistry(gate);
  const execute = vi.fn(async () => "done");
  for (const [id, access] of [
    ["ordinary", undefined],
    ["privileged", "administrator"],
  ] as const)
    tools.register({
      id,
      ...(access ? { access } : {}),
      description: id,
      inputSchema: z.strictObject({ id: z.string() }),
      outputSchema: z.string(),
      execute,
    });

  await tools.invoke("ordinary", { id: "a" }, context);
  expect(await tools.invoke("privileged", { id: 5 }, context)).toEqual({
    isValid: false,
    output: null,
  });

  expect(gate).not.toHaveBeenCalled();
  expect(execute).toHaveBeenCalledTimes(1);
});

it("lists and classifies tools by access and leaves administrator tools out on request", () => {
  const tools = new RuntimeToolRegistry();
  for (const [id, access] of [
    ["ordinary", undefined],
    ["privileged", "administrator"],
  ] as const)
    tools.register({
      id,
      ...(access ? { access } : {}),
      description: id,
      inputSchema: z.strictObject({}),
      outputSchema: z.string(),
      execute: async () => id,
    });

  expect(tools.describe().map(({ id, access }) => [id, access])).toEqual([
    ["ordinary", "user"],
    ["privileged", "administrator"],
  ]);
  expect(
    tools.describe({ includeAdministrator: false }).map(({ id }) => id),
  ).toEqual(["ordinary"]);
  expect(tools.accessOf("privileged")).toBe("administrator");
  expect(tools.accessOf("ordinary")).toBe("user");
  expect(tools.accessOf("missing")).toBeNull();
});
