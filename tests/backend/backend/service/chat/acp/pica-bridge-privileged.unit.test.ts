import { expect, it, vi } from "vitest";

import { PicaBridge } from "@/backend/service/chat/acp/PicaBridge";

import { operatorWorld } from "../admin/pica-operator-world";

import type { ChatJobToolEvent } from "@/definition/ChatJob";

// The plan tools come from the independent MCP catalog, which Pages unit tests do not load.
vi.mock("@/backend/service/chat/PicaPlanTools", () => ({
  registerPicaPlanTools: vi.fn(),
}));
vi.mock("@/backend/runtime/ProcessLifecycle", () => ({
  registerShutdownTask: vi.fn(),
}));

/** The bridge of one job over the real tools; it answers as the agent session would see it. */
function bridgeOf(world: ReturnType<typeof operatorWorld>): {
  readonly events: Omit<ChatJobToolEvent, "kind">[];
  readonly tools: () => Promise<string[]>;
  readonly call: (name: string, input: unknown) => Promise<unknown>;
} {
  const bridge = new PicaBridge("http://127.0.0.1:3100/api/v1/pica-bridge");
  const turn = world.turn("turn-1", "Hallo");
  const events: Omit<ChatJobToolEvent, "kind">[] = [];
  const lease = bridge.open({
    jobId: "job",
    catalog: turn.registry.describe({
      includeAdministrator: world.person.isAdmin,
    }),
    onTool: (event) => events.push(event),
  });
  lease.setTurn({ tools: turn.registry, context: turn.context });
  const { server } = lease;
  if (!("headers" in server)) throw new Error("The bridge is an HTTP server");
  const authorization = server.headers[0]?.value ?? null;
  const send = async (method: string, params?: unknown): Promise<unknown> =>
    (
      await bridge.handle({
        method: "POST",
        authorization,
        readBody: async () =>
          JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      })
    ).body;
  return {
    events,
    tools: async () => {
      const body = await send("tools/list");
      const tools = (body as { result: { tools: { name: string }[] } }).result
        .tools;
      return tools.map(({ name }) => name);
    },
    call: async (name, input) => {
      const body = await send("tools/call", { name, arguments: input });
      const text = (body as { result: { content: { text: string }[] } }).result
        .content[0].text;
      return JSON.parse(text);
    },
  };
}

it("lists the administrator tools to an administrator and marks their calls in the journal", async () => {
  const world = operatorWorld();
  const bridge = bridgeOf(world);

  expect(await bridge.tools()).toContain("list_admin_users");
  expect(await bridge.call("list_admin_users", {})).toMatchObject({
    ok: true,
  });
  await bridge.call("projects_list", {});

  expect(bridge.events).toEqual([
    expect.objectContaining({
      tool: "list_admin_users",
      status: "running",
      isPrivileged: true,
    }),
    expect.objectContaining({
      tool: "list_admin_users",
      status: "completed",
      isPrivileged: true,
    }),
    expect.objectContaining({ tool: "projects_list", status: "running" }),
    expect.objectContaining({ tool: "projects_list", status: "completed" }),
  ]);
  expect(bridge.events[2]).not.toHaveProperty("isPrivileged");
});

it("hides the administrator tools from a person and refuses a guessed call visibly", async () => {
  const world = operatorWorld({ isAdmin: false });
  const bridge = bridgeOf(world);

  expect(await bridge.tools()).not.toContain("list_admin_users");
  expect(await bridge.call("list_admin_users", {})).toEqual({
    ok: false,
    result: null,
    error: "ADMIN_REQUIRED",
  });

  expect(world.router).not.toHaveBeenCalled();
  expect(bridge.events.at(-1)).toMatchObject({
    tool: "list_admin_users",
    status: "failed",
    error: "ADMIN_REQUIRED",
    isPrivileged: true,
  });
});
