import { expect, it, vi } from "vitest";

import {
  parseDreamDocument,
  lessonId,
} from "@/backend/service/employee/AgentDreamDocument";
import { AgentLessonsAdministration } from "@/backend/service/employee/AgentLessonsAdministration";

import { FakeRecipes, recipe } from "./page378-recipe-fixture";

import type { AgentChatSessionViewer } from "@/backend/service/employee/AgentChatSessionService";
import type { User } from "@/definition/User";
import { partialStub } from "../../stub-fixture";

const ADMIN: AgentChatSessionViewer = {
  user: partialStub<User>({ id: "admin", displayName: "Ada" }),
  isAdministrator: true,
};
const MEMBER: AgentChatSessionViewer = {
  user: partialStub<User>({ id: "igor", displayName: "Igor" }),
  isAdministrator: false,
};
const REPO = "Das Pages-Repo liegt unter /home/igor/Repo/Pages.";
const STATUS = "Status-ID für Review ist status-review.";

/** The lessons and recipes of one agent with the fake store behind them. */
interface LessonsWorld {
  readonly service: AgentLessonsAdministration;
  readonly fake: FakeRecipes;
  readonly state: { dream: string; characters: number };
  readonly saveDream: ReturnType<typeof vi.fn>;
}

function world(
  dream = `- ${REPO} — Beleg: 5× gesucht · Datum: 2026-11-01 · Stärke: 3\n- ${STATUS} — Beleg: PAGE-1 · Datum: 2026-11-02 · Stärke: 1`,
): LessonsWorld {
  const fake = new FakeRecipes();
  fake.recipes = [
    recipe(),
    recipe({
      id: "recipe-2",
      name: "pages-repo",
      kind: "knowledge",
      summary: "Wo das Repo liegt",
      keywords: ["repo"],
      parameters: [],
      steps: [],
      body: "Unter /home/igor/Repo/Pages.",
    }),
  ];
  const state = { dream, characters: 4_000 };
  const saveDream = vi.fn(async (agent: string, text: string) => {
    state.dream = text;
  });
  const service = new AgentLessonsAdministration({
    store: partialStub<never>({
      employees: () => ({
        find: async () => ({
          userId: "ed",
          dream: state.dream,
          dreamCharacters: state.characters,
        }),
      }),
      recipes: () => fake.store().recipes(),
    }),
    users: {
      findById: async (id: string) =>
        id === "ed"
          ? partialStub<User>({ id: "ed", displayName: "Ed", isAgent: true })
          : null,
    },
    memory: { saveDream },
    now: () => new Date("2026-11-13T10:00:00.000Z"),
  });
  return { service, fake, state, saveDream };
}

it("lists the lessons with evidence and strength and the recipes with kind, steps, uses and status", async () => {
  const { service } = world();
  const overview = await service.overview(ADMIN, "ed");
  expect(overview.canChange).toBe(true);
  expect(overview.lessons).toEqual([
    {
      id: lessonId(REPO),
      text: REPO,
      evidence: "5× gesucht",
      date: "2026-11-01",
      strength: 3,
      isActive: true,
    },
    {
      id: lessonId(STATUS),
      text: STATUS,
      evidence: "PAGE-1",
      date: "2026-11-02",
      strength: 1,
      isActive: true,
    },
  ]);
  expect(overview.recipes[0]).toMatchObject({
    id: "recipe-1",
    name: "ticket-anlegen",
    kind: "flow",
    useCount: 0,
    isActive: true,
    steps: [
      { tool: "tickets_search" },
      { tool: "tickets_create" },
      { tool: "tickets_read" },
    ],
  });
  expect(overview.recipes[1]).toMatchObject({
    kind: "knowledge",
    body: "Unter /home/igor/Repo/Pages.",
  });
  expect(overview.dream.limit).toBe(4_000);
});

it("shows everybody else empty lists and lets them change nothing", async () => {
  const { service, saveDream } = world();
  expect(await service.overview(MEMBER, "ed")).toMatchObject({
    canChange: false,
    lessons: [],
    recipes: [],
  });
  await expect(service.removeLesson(MEMBER, "ed", "x")).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(
    service.setRecipeActive(MEMBER, "ed", { id: "recipe-1", isActive: false }),
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(
    service.removeRecipe(MEMBER, "ed", "recipe-1"),
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(service.overview(ADMIN, "none")).rejects.toMatchObject({
    code: "notFound",
  });
  expect(saveDream).not.toHaveBeenCalled();
});

it("edits a lesson, switches it off and on, and deletes it, in DREAM.md", async () => {
  const { service, state } = world();
  await service.saveLesson(ADMIN, "ed", {
    lessonId: lessonId(STATUS),
    text: "Status-ID für Review ist status-in-review.",
    evidence: "PAGE-2",
  });
  expect(state.dream).toContain(
    "Status-ID für Review ist status-in-review. — Beleg: PAGE-2",
  );
  expect(state.dream).not.toContain("status-review.");

  const id = lessonId(REPO);
  await service.setLessonActive(ADMIN, "ed", { id, isActive: false });
  expect(
    parseDreamDocument(state.dream, "2026-11-13").find(
      (lesson) => lesson.text === REPO,
    )?.isActive,
  ).toBe(false);
  expect(state.dream).toContain(`Stärke: 3 · aus`);
  expect(
    (await service.overview(ADMIN, "ed")).lessons.find(
      (lesson) => lesson.id === id,
    )?.isActive,
  ).toBe(false);
  await service.setLessonActive(ADMIN, "ed", { id, isActive: true });
  expect(state.dream).not.toContain("· aus");

  await service.removeLesson(ADMIN, "ed", id);
  expect(
    parseDreamDocument(state.dream, "2026-11-13").map((lesson) => lesson.text),
  ).toEqual(["Status-ID für Review ist status-in-review."]);
  await expect(
    service.removeLesson(ADMIN, "ed", "unbekannt"),
  ).rejects.toMatchObject({ code: "notFound" });
  await expect(
    service.saveLesson(ADMIN, "ed", { lessonId: id, text: "", evidence: "x" }),
  ).rejects.toMatchObject({ code: "invalidInput" });
  await expect(
    service.saveLesson(ADMIN, "ed", {
      lessonId: "unbekannt",
      text: "x",
      evidence: "y",
    }),
  ).rejects.toMatchObject({ code: "notFound" });
});

it("edits a recipe: summary, keywords, parameters and steps, checked like one of the dream run", async () => {
  const { service, fake } = world();
  await service.saveRecipe(ADMIN, "ed", {
    recipeId: "recipe-1",
    name: "Ticket neu",
    summary: "Neue Beschreibung",
    keywords: "Ticket, neu , ",
    body: "",
    parameters: JSON.stringify([
      { name: "projekt", description: "Projekt-ID" },
    ]),
    steps: JSON.stringify([
      {
        tool: "tickets_create",
        input: { projectId: "{{projekt}}" },
        note: "anlegen",
      },
      {
        tool: "tickets_read",
        input: { ticketId: "{{1.id}}" },
        note: "Kontrolle",
      },
    ]),
  });
  expect(fake.recipes[0]).toMatchObject({
    name: "ticket-neu",
    summary: "Neue Beschreibung",
    keywords: ["ticket", "neu"],
    // Strength and the day of confirmation stay: an edit is no confirmation.
    strength: 2,
    confirmedOn: "2026-11-01",
  });
  expect(fake.recipes[0]?.steps.map((step) => step.tool)).toEqual([
    "tickets_create",
    "tickets_read",
  ]);
});

it("refuses an edited recipe with a deleting step, a taken name, broken JSON or a missing recipe", async () => {
  const { service, fake } = world();
  const base = {
    recipeId: "recipe-1",
    name: "ticket-anlegen",
    summary: "s",
    keywords: "",
    body: "",
    parameters: "[]",
    steps: JSON.stringify([{ tool: "tickets_read", input: {}, note: "" }]),
  };
  await expect(
    service.saveRecipe(ADMIN, "ed", {
      ...base,
      steps: JSON.stringify([
        { tool: "tickets_delete", input: { ticketId: "1" }, note: "" },
      ]),
    }),
  ).rejects.toMatchObject({ code: "invalidInput" });
  await expect(
    service.saveRecipe(ADMIN, "ed", { ...base, steps: "kein json" }),
  ).rejects.toMatchObject({ code: "invalidInput" });
  await expect(
    service.saveRecipe(ADMIN, "ed", { ...base, name: "pages-repo" }),
  ).rejects.toMatchObject({ code: "conflict" });
  await expect(
    service.saveRecipe(ADMIN, "ed", { ...base, recipeId: "gone" }),
  ).rejects.toMatchObject({ code: "notFound" });
  expect(fake.recipes[0]?.steps).toHaveLength(3);
});

it("switches a recipe off and on and deletes it; switching on again starts its failures afresh", async () => {
  const { service, fake } = world();
  fake.recipes[0] = recipe({
    isActive: false,
    disabledReason: "failed",
    failureStreak: 2,
    lastError: "tickets_create: FORBIDDEN",
  });
  await service.setRecipeActive(ADMIN, "ed", {
    id: "recipe-1",
    isActive: true,
  });
  expect(fake.recipes[0]).toMatchObject({
    isActive: true,
    disabledReason: null,
    failureStreak: 0,
    lastError: null,
  });
  await service.setRecipeActive(ADMIN, "ed", {
    id: "recipe-1",
    isActive: false,
  });
  expect(fake.recipes[0]).toMatchObject({
    isActive: false,
    disabledReason: "manual",
  });
  await expect(
    service.setRecipeActive(ADMIN, "ed", { id: "gone", isActive: true }),
  ).rejects.toMatchObject({ code: "notFound" });

  await service.removeRecipe(ADMIN, "ed", "recipe-1");
  expect(fake.recipes.map((entry) => entry.id)).toEqual(["recipe-2"]);
  await expect(
    service.removeRecipe(ADMIN, "ed", "recipe-1"),
  ).rejects.toMatchObject({ code: "notFound" });
  await expect(service.removeRecipe(ADMIN, "ed", "")).rejects.toMatchObject({
    code: "invalidInput",
  });
});
