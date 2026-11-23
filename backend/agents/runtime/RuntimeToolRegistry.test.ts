import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  RuntimeToolDeniedError,
  RuntimeToolRegistry,
} from "@/backend/agents/runtime/RuntimeToolRegistry";

import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { RuntimeToolDefinition } from "@/backend/agents/runtime/RuntimeToolRegistry";

function contextFor(
  signal: AbortSignal = new AbortController().signal,
  authorize: () => Promise<void> = () => Promise.resolve(),
): RuntimeExecutionContext {
  return {
    userId: "u",
    sessionId: "s",
    runId: "r",
    signal,
    authorize,
  };
}

function echo(
  extra: Partial<
    RuntimeToolDefinition<{ text: string }, { text: string }>
  > = {},
): RuntimeToolDefinition<{ text: string }, { text: string }> {
  return {
    id: "echo",
    description: "Echoes",
    inputSchema: z.object({ text: z.string() }),
    outputSchema: z.object({ text: z.string() }),
    execute: (input) => Promise.resolve(input),
    ...extra,
  };
}

describe("RuntimeToolRegistry registration", () => {
  it("rejects invalid and duplicate IDs", () => {
    const registry = new RuntimeToolRegistry();
    expect(() => registry.register(echo({ id: "bad id" }))).toThrow("Invalid");
    registry.register(echo());
    expect(() => registry.register(echo())).toThrow("already");
  });

  it("describes tools without the schema dialect marker", () => {
    const registry = new RuntimeToolRegistry();
    registry.register(echo());
    registry.register(echo({ id: "admin", access: "administrator" }));
    const [first] = registry.describe();
    expect(first).toMatchObject({ id: "echo", access: "user" });
    expect(first.inputSchema).not.toHaveProperty("$schema");
    expect(registry.describe()).toHaveLength(2);
    expect(registry.describe({ includeAdministrator: false })).toHaveLength(1);
    expect(registry.describe({ includeAdministrator: true })).toHaveLength(2);
  });

  it("retains only admitted tools and reports access classes", () => {
    const registry = new RuntimeToolRegistry();
    registry.register(echo());
    registry.register(echo({ id: "admin", access: "administrator" }));
    expect(registry.accessOf("admin")).toBe("administrator");
    registry.retain((id) => id === "echo");
    expect(registry.accessOf("admin")).toBeNull();
    expect(registry.accessOf("echo")).toBe("user");
  });
});

describe("RuntimeToolRegistry.invoke", () => {
  it("returns null for an unknown tool", async () => {
    expect(
      await new RuntimeToolRegistry().invoke("nope", {}, contextFor()),
    ).toBeNull();
  });

  it("runs a valid call and tells the observers", async () => {
    const registry = new RuntimeToolRegistry();
    registry.register(echo());
    const observer = vi.fn();
    registry.observe(observer);
    const result = await registry.invoke("echo", { text: "hi" }, contextFor());
    expect(result).toEqual({ isValid: true, output: { text: "hi" } });
    expect(observer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "echo", sessionId: "s" }),
    );
  });

  it("refuses invalid input without running the handler", async () => {
    const execute = vi.fn();
    const registry = new RuntimeToolRegistry();
    registry.register(echo({ execute }));
    expect(await registry.invoke("echo", { text: 1 }, contextFor())).toEqual({
      isValid: false,
      output: null,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects output that violates its schema", async () => {
    const registry = new RuntimeToolRegistry();
    registry.register(
      echo({ outputSchema: z.object({ text: z.string().min(5) }) }),
    );
    await expect(
      registry.invoke("echo", { text: "a" }, contextFor()),
    ).rejects.toThrow();
  });

  it("checks cancellation around authorization", async () => {
    const registry = new RuntimeToolRegistry();
    registry.register(echo());
    const early = new AbortController();
    early.abort();
    await expect(
      registry.invoke("echo", { text: "a" }, contextFor(early.signal)),
    ).rejects.toThrow();
    const late = new AbortController();
    await expect(
      registry.invoke(
        "echo",
        { text: "a" },
        contextFor(late.signal, () => {
          late.abort();
          return Promise.resolve();
        }),
      ),
    ).rejects.toThrow();
  });

  it("admits an administrator tool only through the gate", async () => {
    const admit = vi.fn(() => Promise.resolve(true));
    const admitting = new RuntimeToolRegistry(admit);
    admitting.register(echo({ id: "admin", access: "administrator" }));
    expect(
      await admitting.invoke("admin", { text: "a" }, contextFor()),
    ).toEqual({ isValid: true, output: { text: "a" } });
    expect(admit).toHaveBeenCalledWith(expect.anything(), "admin");

    const denying = new RuntimeToolRegistry(() => Promise.resolve(false));
    denying.register(echo({ id: "admin", access: "administrator" }));
    await expect(
      denying.invoke("admin", { text: "a" }, contextFor()),
    ).rejects.toBeInstanceOf(RuntimeToolDeniedError);

    const gateless = new RuntimeToolRegistry();
    gateless.register(echo({ id: "admin", access: "administrator" }));
    await expect(
      gateless.invoke("admin", { text: "a" }, contextFor()),
    ).rejects.toMatchObject({
      name: "RuntimeToolDeniedError",
      toolId: "admin",
    });
  });

  it("stops when the signal aborted while the gate decided", async () => {
    const controller = new AbortController();
    const registry = new RuntimeToolRegistry(() => {
      controller.abort();
      return Promise.resolve(true);
    });
    registry.register(echo({ id: "admin", access: "administrator" }));
    await expect(
      registry.invoke("admin", { text: "a" }, contextFor(controller.signal)),
    ).rejects.toThrow();
  });
});
