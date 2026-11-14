import { z } from "zod";
import { expect, it, vi } from "vitest";

import { RuntimeToolRegistry } from "@/backend/agents/runtime/RuntimeToolRegistry";
import {
  observePicaToolUse,
  registerPicaRecipeTool,
} from "@/backend/service/chat/PicaRecipeTool";
import { createPicaTools } from "@/backend/service/chat/PicaTools";
import { PICA_TOOL_OUTCOME } from "@/backend/service/chat/PicaToolSchemas";
import { AgentRecipeService } from "@/backend/service/employee/AgentRecipeService";

import { AGENT, FakeRecipes, recipe } from "../employee/page378-recipe-fixture";

import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { AgentRecipeTools } from "@/definition/AgentDreaming";

const CONTEXT: RuntimeExecutionContext = {
  userId: AGENT,
  sessionId: "igor",
  runId: "run-1",
  signal: new AbortController().signal,
  authorize: async () => undefined,
};

/** A tool of the session that answers with a JSON result and counts its calls. */
function register(
  registry: RuntimeToolRegistry,
  id: string,
  answer: (input: Record<string, unknown>) => {
    ok: boolean;
    result: unknown;
    error?: string;
  },
  access: "user" | "administrator" = "user",
): ReturnType<typeof vi.fn> {
  const handler = vi.fn(async (input: Record<string, unknown>) => {
    const outcome = answer(input);
    return {
      ok: outcome.ok,
      result: JSON.stringify(outcome.result),
      error: outcome.error ?? null,
    };
  });
  registry.register({
    id,
    description: id,
    access,
    inputSchema: z.record(z.string(), z.unknown()),
    outputSchema: PICA_TOOL_OUTCOME,
    execute: handler,
  });
  return handler;
}

function session(recipes: ReturnType<typeof recipe>[]): {
  registry: RuntimeToolRegistry;
  fake: FakeRecipes;
  tools: AgentRecipeTools;
} {
  const registry = new RuntimeToolRegistry(async () => false);
  const fake = new FakeRecipes();
  fake.recipes = recipes;
  const tools = new AgentRecipeService({ store: fake.store() }).tools({
    agentId: AGENT,
    sessionId: "igor",
  });
  registerPicaRecipeTool(
    registry,
    { authorize: async () => undefined, recipes: tools },
    () => true,
  );
  return { registry, fake, tools };
}

it("calls a flow recipe with one tool call and runs its whole tool chain", async () => {
  const { registry } = session([recipe()]);
  const search = register(registry, "tickets_search", () => ({
    ok: true,
    result: { statuses: ["todo"] },
  }));
  const create = register(registry, "tickets_create", () => ({
    ok: true,
    result: { id: "t-9" },
  }));
  const read = register(registry, "tickets_read", (input) => ({
    ok: true,
    result: { id: input.ticketId, title: "Neu" },
  }));

  const invoked = await registry.invoke(
    "rezept",
    { name: "ticket-anlegen", parameter: { projekt: "p-1" } },
    CONTEXT,
  );

  expect(invoked?.isValid).toBe(true);
  const outcome = PICA_TOOL_OUTCOME.parse(invoked?.output);
  expect(outcome.ok).toBe(true);
  const result = JSON.parse(outcome.result ?? "{}") as {
    schritte: unknown[];
    ergebnis: string;
  };
  expect(result.schritte).toHaveLength(3);
  expect(JSON.parse(result.ergebnis)).toEqual({ id: "t-9", title: "Neu" });
  expect(search).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledWith({ ticketId: "t-9" }, expect.anything());
});

it("gives a recipe no right beyond the tools of the session: a tool the agent has not is a failed step", async () => {
  const { registry, fake } = session([recipe()]);
  // tickets_search exists, but tickets_create and tickets_read are no tools of this session.
  const search = register(registry, "tickets_search", () => ({
    ok: true,
    result: {},
  }));
  const invoked = await registry.invoke(
    "rezept",
    { name: "ticket-anlegen", parameter: { projekt: "p" } },
    CONTEXT,
  );
  const outcome = PICA_TOOL_OUTCOME.parse(invoked?.output);
  expect(outcome).toMatchObject({ ok: false, error: "RECIPE_FAILED" });
  expect(JSON.parse(outcome.result ?? "{}")).toMatchObject({
    gescheitert: {
      schritt: 2,
      werkzeug: "tickets_create",
      fehler: "TOOL_UNAVAILABLE",
    },
  });
  expect(search).toHaveBeenCalledTimes(1);
  expect(fake.recipes[0]?.failureStreak).toBe(1);
});

it("never runs an administrator tool, a deleting tool or the recipe tool itself: the chain stops before it", async () => {
  const chain = (tool: string): ReturnType<typeof recipe> =>
    recipe({
      parameters: [],
      steps: [
        { tool: "tickets_read", input: { ticketId: "t-1" }, note: "" },
        { tool: tool, input: { ticketId: "t-1" }, note: "" },
        { tool: "tickets_read", input: { ticketId: "t-2" }, note: "" },
      ],
    });
  for (const [tool, access] of [
    ["tickets_delete", "user"],
    ["admin_users", "administrator"],
  ] as const) {
    const { registry, fake } = session([chain(tool)]);
    const read = register(registry, "tickets_read", () => ({
      ok: true,
      result: {},
    }));
    const risky = register(
      registry,
      tool,
      () => ({ ok: true, result: {} }),
      access,
    );
    const invoked = await registry.invoke(
      "rezept",
      { name: "ticket-anlegen" },
      CONTEXT,
    );
    const outcome = PICA_TOOL_OUTCOME.parse(invoked?.output);
    expect(outcome).toMatchObject({
      ok: false,
      error: "CONFIRMATION_REQUIRED",
    });
    expect(JSON.parse(outcome.result ?? "{}")).toMatchObject({
      bestaetigung: { schritt: 2, werkzeug: tool },
    });
    // Only the step before ran; the risky tool and the one after it never did.
    expect(read).toHaveBeenCalledTimes(1);
    expect(risky).not.toHaveBeenCalled();
    // Waiting for the confirmation is no failure.
    expect(fake.recipes[0]).toMatchObject({ failureStreak: 0, isActive: true });
  }

  const { registry } = session([
    recipe({
      parameters: [],
      steps: [{ tool: "rezept", input: { name: "ticket-anlegen" }, note: "" }],
    }),
  ]);
  const invoked = await registry.invoke(
    "rezept",
    { name: "ticket-anlegen" },
    CONTEXT,
  );
  expect(PICA_TOOL_OUTCOME.parse(invoked?.output)).toMatchObject({
    ok: false,
    error: "RECIPE_FAILED",
  });
});

it("takes the confirmation a tool asks for as a stop, not as a failure, and passes the budget through", async () => {
  const { registry, fake } = session([
    recipe({
      parameters: [],
      steps: [{ tool: "storage_move", input: { ref: "a" }, note: "" }],
    }),
  ]);
  register(registry, "storage_move", () => ({
    ok: false,
    result: null,
    error: "CONFIRMATION_REQUIRED",
  }));
  const invoked = await registry.invoke(
    "rezept",
    { name: "ticket-anlegen" },
    CONTEXT,
  );
  expect(PICA_TOOL_OUTCOME.parse(invoked?.output)).toMatchObject({
    ok: false,
    error: "CONFIRMATION_REQUIRED",
  });
  expect(fake.recipes[0]?.failureStreak).toBe(0);

  const limited = new RuntimeToolRegistry();
  registerPicaRecipeTool(
    limited,
    {
      authorize: async () => undefined,
      recipes: { run: vi.fn(), note: vi.fn() },
    },
    () => false,
  );
  const stopped = await limited.invoke("rezept", {}, CONTEXT);
  expect(PICA_TOOL_OUTCOME.parse(stopped?.output)).toMatchObject({
    ok: false,
    error: "STEP_LIMIT",
  });
});

it("lists its recipes without a name and lists itself in the catalog of the tools", async () => {
  const { registry } = session([recipe()]);
  const invoked = await registry.invoke("rezept", {}, CONTEXT);
  const outcome = PICA_TOOL_OUTCOME.parse(invoked?.output);
  expect(JSON.parse(outcome.result ?? "{}")).toEqual({
    rezepte: [
      {
        name: "ticket-anlegen",
        kind: "flow",
        summary: expect.any(String) as unknown,
        parameters: ["projekt"],
      },
    ],
  });
  const description = registry.describe().find((tool) => tool.id === "rezept");
  expect(description?.inputSchema).toMatchObject({
    properties: { name: { type: "string" }, parameter: { type: "object" } },
  });
  expect(description?.description).toContain("rezept(name, parameter)");
});

it("hands every call of the tools to the record the dream run learns from, with input, result and failure", async () => {
  const registry = new RuntimeToolRegistry();
  const note = vi.fn();
  register(registry, "tickets_search", () => ({
    ok: true,
    result: { items: [] },
  }));
  register(registry, "tickets_create", () => ({
    ok: false,
    result: null,
    error: "FORBIDDEN",
  }));
  registry.register({
    id: "strict",
    description: "strict",
    inputSchema: z.object({ id: z.string() }).strict(),
    outputSchema: PICA_TOOL_OUTCOME,
    execute: async () => ({ ok: true, result: "{}", error: null }),
  });
  observePicaToolUse(registry, { note });

  await registry.invoke(
    "tickets_search",
    { query: "Release Token ghp_abcdefghijklmnopqrstuvwxyz123456" },
    CONTEXT,
  );
  await registry.invoke("tickets_create", { title: "x" }, CONTEXT);
  await registry.invoke("strict", { id: 1 }, CONTEXT);

  expect(
    note.mock.calls.map(([call]) => [call.tool, call.isOk, call.error]),
  ).toEqual([
    ["tickets_search", true, null],
    ["tickets_create", false, "FORBIDDEN"],
    ["strict", false, "INVALID_INPUT"],
  ]);
  const first = note.mock.calls[0]?.[0] as { input: string; output: string };
  expect(first.input).toContain("Release");
  expect(first.input).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz123456");
  expect(first.output).toBe('{"items":[]}');
});

it("offers rezept in the tools of a turn only with the recipes of an agent employee", () => {
  const base = {
    tools: { run: vi.fn() },
    sessions: { confirmationWord: vi.fn() },
    authorize: async () => undefined,
  };
  const without = createPicaTools(base);
  expect(without.describe().some((tool) => tool.id === "rezept")).toBe(false);
  const withRecipes = createPicaTools({
    ...base,
    recipes: { run: vi.fn(), note: vi.fn() },
  });
  expect(withRecipes.describe().some((tool) => tool.id === "rezept")).toBe(
    true,
  );
});
