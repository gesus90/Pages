import { expect, it, vi } from "vitest";

import { AgentRecipeService } from "@/backend/service/employee/AgentRecipeService";

import { AGENT, FakeRecipes, recipe } from "./page378-recipe-fixture";

import type { AgentRecipeStepRunner } from "@/definition/AgentDreaming";

const OK: AgentRecipeStepRunner = {
  offers: () => "ok",
  call: vi.fn(async () => ({
    isOk: true as const,
    result: JSON.stringify({ id: "t-1" }),
  })),
};

function failingAt(tool: string): AgentRecipeStepRunner {
  return {
    offers: () => "ok",
    call: vi.fn(async (name: string) =>
      name === tool
        ? { isOk: false as const, error: "FORBIDDEN", result: null }
        : { isOk: true as const, result: JSON.stringify({ id: "t-1" }) },
    ),
  };
}

function world(...recipes: ReturnType<typeof recipe>[]): {
  fake: FakeRecipes;
  service: AgentRecipeService;
} {
  const fake = new FakeRecipes();
  fake.recipes = recipes;
  return {
    fake,
    service: new AgentRecipeService({
      store: fake.store(),
      now: () => new Date("2026-11-13T10:00:00.000Z"),
    }),
  };
}

const TOOLS = { agentId: AGENT, sessionId: "igor" };

it("runs a flow recipe by name in one call and counts the use", async () => {
  const { fake, service } = world(recipe());
  const answer = await service
    .tools(TOOLS)
    .run({ name: "Ticket anlegen", parameter: { projekt: "p-1" } }, OK);
  expect(answer.isOk).toBe(true);
  expect(answer.result).toMatchObject({
    rezept: "ticket-anlegen",
    schritte: [{ nr: 1 }, { nr: 2 }, { nr: 3 }],
  });
  expect(fake.recipes[0]).toMatchObject({
    useCount: 1,
    lastUsedAt: "2026-11-13T10:00:00.000Z",
    failureStreak: 0,
  });
});

it("switches a recipe off after it failed twice in a row, and never before", async () => {
  const { fake, service } = world(recipe());
  const tools = service.tools(TOOLS);
  const input = { name: "ticket-anlegen", parameter: { projekt: "p-1" } };

  const first = await tools.run(input, failingAt("tickets_create"));
  expect(first).toMatchObject({
    isOk: false,
    error: "RECIPE_FAILED",
    result: {
      gescheitert: { schritt: 2, werkzeug: "tickets_create" },
      ausgeschaltet: false,
    },
  });
  expect(fake.recipes[0]).toMatchObject({ isActive: true, failureStreak: 1 });

  const second = await tools.run(input, failingAt("tickets_create"));
  expect(second.result).toMatchObject({ ausgeschaltet: true });
  expect(fake.recipes[0]).toMatchObject({
    isActive: false,
    disabledReason: "failed",
    failureStreak: 2,
    lastError: "tickets_create: FORBIDDEN",
  });

  // A switched-off recipe is not run any more; the agent is told so.
  const third = await tools.run(input, OK);
  expect(third).toMatchObject({
    isOk: false,
    error: "RECIPE_DISABLED",
    result: { grund: "failed" },
  });
  expect(OK.call).not.toHaveBeenCalledWith("tickets_search", expect.anything());
});

it("starts the failures again after a success", async () => {
  const { fake, service } = world(recipe());
  const tools = service.tools(TOOLS);
  const input = { name: "ticket-anlegen", parameter: { projekt: "p-1" } };
  await tools.run(input, failingAt("tickets_read"));
  expect(fake.recipes[0]?.failureStreak).toBe(1);
  await tools.run(input, OK);
  expect(fake.recipes[0]).toMatchObject({ failureStreak: 0, isActive: true });
  await tools.run(input, failingAt("tickets_read"));
  expect(fake.recipes[0]).toMatchObject({ failureStreak: 1, isActive: true });
});

it("counts neither a stopped confirmation nor missing parameters nor an exhausted budget as a failure", async () => {
  const { fake, service } = world(recipe());
  const tools = service.tools(TOOLS);
  const confirming: AgentRecipeStepRunner = {
    offers: (tool) => (tool === "tickets_create" ? "confirmation" : "ok"),
    call: vi.fn(async () => ({ isOk: true as const, result: "{}" })),
  };
  const stopped = await tools.run(
    { name: "ticket-anlegen", parameter: { projekt: "p" } },
    confirming,
  );
  expect(stopped).toMatchObject({
    isOk: false,
    error: "CONFIRMATION_REQUIRED",
    result: { bestaetigung: { schritt: 2, werkzeug: "tickets_create" } },
  });
  const missing = await tools.run({ name: "ticket-anlegen" }, OK);
  expect(missing).toMatchObject({
    error: "INVALID_REQUEST",
    result: { fehlendeParameter: ["projekt"] },
  });
  const limited: AgentRecipeStepRunner = {
    offers: () => "ok",
    call: vi.fn(async () => ({
      isOk: false as const,
      error: "STEP_LIMIT",
      result: null,
    })),
  };
  await tools.run(
    { name: "ticket-anlegen", parameter: { projekt: "p" } },
    limited,
  );
  expect(fake.recipes[0]).toMatchObject({
    failureStreak: 0,
    useCount: 0,
    isActive: true,
  });
});

it("answers a knowledge recipe with its guide and lists the recipes without a name", async () => {
  const guide = recipe({
    id: "recipe-2",
    name: "pages-repo",
    kind: "knowledge",
    summary: "Wo das Repo liegt",
    parameters: [],
    steps: [],
    body: "Das Repo liegt unter /home/igor/Repo/Pages.",
  });
  const { fake, service } = world(
    recipe(),
    guide,
    recipe({
      id: "recipe-3",
      name: "alt",
      isActive: false,
      disabledReason: "manual",
    }),
  );
  const tools = service.tools(TOOLS);

  expect(await tools.run({ name: "pages-repo" }, OK)).toMatchObject({
    isOk: true,
    result: {
      art: "wissen",
      anleitung: "Das Repo liegt unter /home/igor/Repo/Pages.",
    },
  });
  expect(fake.recipes[1]?.useCount).toBe(1);

  const list = await tools.run({}, OK);
  expect(list.result).toEqual({
    rezepte: [
      {
        name: "ticket-anlegen",
        kind: "flow",
        summary: expect.any(String),
        parameters: ["projekt"],
      },
      {
        name: "pages-repo",
        kind: "knowledge",
        summary: "Wo das Repo liegt",
        parameters: [],
      },
    ],
  });
  expect(await tools.run({ name: "gibt-es-nicht" }, OK)).toMatchObject({
    isOk: false,
    error: "NOT_FOUND",
    result: { verfuegbar: ["ticket-anlegen", "pages-repo"] },
  });
  expect(await tools.run({ name: 5 }, OK)).toMatchObject({
    error: "INVALID_REQUEST",
  });
});

it("tells a round the list of recipes and only the knowledge recipes that fit its topic", async () => {
  const { service } = world(
    recipe(),
    recipe({
      id: "k1",
      name: "pages-repo",
      kind: "knowledge",
      summary: "Wo das Repo liegt",
      keywords: ["repo", "pfad"],
      parameters: [],
      steps: [],
      body: "Unter /home/igor/Repo/Pages.",
    }),
    recipe({
      id: "k2",
      name: "storage-regeln",
      kind: "knowledge",
      summary: "Regeln für Storage",
      keywords: ["storage"],
      parameters: [],
      steps: [],
      body: "Nutze keep_both.",
    }),
  );
  const brief = await service.brief(
    AGENT,
    "Wo finde ich das Pages-Repo auf dem Rechner?",
  );
  expect(brief.available.map((entry) => entry.name)).toEqual([
    "ticket-anlegen",
    "pages-repo",
    "storage-regeln",
  ]);
  expect(brief.knowledge).toEqual([
    { name: "pages-repo", body: "Unter /home/igor/Repo/Pages." },
  ]);
  expect((await service.brief(AGENT, "Guten Morgen")).knowledge).toEqual([]);
});

it("records the tool calls of a chat session for the dream run, but not those of a confidential chat", async () => {
  const { fake, service } = world();
  fake.confidential.add("secret");
  const call = {
    tool: "tickets_search",
    input: '{"q":"x"}',
    output: "[]",
    isOk: true,
    error: null,
  };

  service.tools(TOOLS).note(call);
  service.tools({ agentId: AGENT, sessionId: "secret" }).note(call);
  service.tools({ agentId: AGENT, sessionId: "gone" }).note(call);
  await vi.waitFor(() => {
    expect(fake.uses).toHaveLength(1);
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(fake.uses).toHaveLength(1);
  expect(fake.uses[0]).toMatchObject({
    tool: "tickets_search",
    input: '{"q":"x"}',
    isOk: true,
  });
});
