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
    jobId: turn.context.runId,
    userId: turn.context.userId,
    sessionId: turn.context.sessionId,
    catalog: turn.registry.describe({
      includeAdministrator: world.person.isAdmin,
    }),
    onTool: (event) => events.push(event),
    onImages: async () => {
      throw new Error("The test tools return no images");
    },
  });
  const descriptor = lease.setTurn({
    id: "turn-1",
    answerTurn: 1,
    tools: turn.registry,
    context: turn.context,
  });
  if (!descriptor) throw new Error("The turn belongs to the job");
  const send = async (request: unknown): Promise<unknown> =>
    (
      await bridge.handle({
        method: "POST",
        authorization: descriptor.authorization,
        readBody: async () => JSON.stringify(request),
      })
    ).body;
  return {
    events,
    tools: async () => {
      const body = await send({ action: "catalog" });
      return (body as { tools: { id: string }[] }).tools.map(({ id }) => id);
    },
    call: async (name, input) =>
      send({ action: "call", name, arguments: input }),
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
