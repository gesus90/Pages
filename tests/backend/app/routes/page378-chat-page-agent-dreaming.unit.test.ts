import { beforeEach, expect, it, vi } from "vitest";

import {
  action as dreamingAction,
  loader as dreamingLoader,
} from "@/app/routes/chat-page-agent-dreaming";
import {
  action as lessonsAction,
  loader as lessonsLoader,
} from "@/app/routes/chat-page-agent-lessons";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";

import { EMPLOYEE } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

const services = vi.hoisted(() => ({
  administrationService: { getContext: vi.fn() },
  agentDreamingAdministration: {
    overview: vi.fn(),
    saveSettings: vi.fn(),
    runNow: vi.fn(),
  },
  agentLessonsAdministration: {
    overview: vi.fn(),
    saveLesson: vi.fn(),
    setLessonActive: vi.fn(),
    removeLesson: vi.fn(),
    saveRecipe: vi.fn(),
    setRecipeActive: vi.fn(),
    removeRecipe: vi.fn(),
  },
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => services,
}));

const ACCESS = {
  userId: "employee",
  role: null,
  isAdmin: true,
  mode: "admin",
  firstName: "Em",
  lastName: "Ployee",
  isActive: true,
  departments: [],
  managedDepartments: [],
  allDepartments: false,
  allProjects: false,
  hasHadDepartment: false,
};

const DREAMING = { agentId: "agent", agentName: "Ed" };
const LESSONS = { agentId: "agent", agentName: "Ed", lessons: [], recipes: [] };

beforeEach(() => {
  vi.resetAllMocks();
  services.administrationService.getContext.mockResolvedValue(ACCESS);
  services.agentDreamingAdministration.overview.mockResolvedValue(DREAMING);
  services.agentLessonsAdministration.overview.mockResolvedValue(LESSONS);
});

function post(
  action: typeof dreamingAction,
  path: string,
  fields: Record<string, string>,
): Promise<Response> {
  const request = new Request(`http://pages.invalid/chat-page-api/${path}`, {
    method: "POST",
    body: new URLSearchParams(fields),
  });
  return action(routeArguments(request, EMPLOYEE, {}));
}

function get(loader: typeof dreamingLoader, path: string): Promise<Response> {
  return loader(
    routeArguments(
      new Request(`http://pages.invalid/chat-page-api/${path}?agentId=agent`),
      EMPLOYEE,
      {},
    ),
  );
}

it("reads the Dreaming of an agent as the viewer sees it", async () => {
  const response = await get(dreamingLoader, "agent-dreaming");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  await expect(response.json()).resolves.toEqual({
    ok: true,
    overview: DREAMING,
  });
  expect(services.agentDreamingAdministration.overview).toHaveBeenCalledWith(
    expect.objectContaining({ user: EMPLOYEE, isAdministrator: true }),
    "agent",
  );
});

it("saves the schedule as the form gives it: the interval, the unit, the time, the weekday and the switches", async () => {
  const response = await post(dreamingAction, "agent-dreaming", {
    intent: "save-settings",
    agentId: "agent",
    enabled: "true",
    interval: "30",
    unit: "days",
    time: "02:00",
    weekday: "",
    onFullLogbook: "false",
    modelConnectionId: "",
    model: "",
  });
  expect(
    services.agentDreamingAdministration.saveSettings,
  ).toHaveBeenCalledWith(
    expect.objectContaining({ isAdministrator: true }),
    "agent",
    {
      enabled: "true",
      interval: "30",
      unit: "days",
      time: "02:00",
      weekday: "",
      onFullLogbook: "false",
      modelConnectionId: "",
      model: "",
    },
  );
  await expect(response.json()).resolves.toEqual({
    ok: true,
    overview: DREAMING,
  });
});

it("starts a run and tells whether it started or waits for the chat", async () => {
  services.agentDreamingAdministration.runNow.mockResolvedValue("waiting");
  const response = await post(dreamingAction, "agent-dreaming", {
    intent: "run-now",
    agentId: "agent",
  });
  await expect(response.json()).resolves.toEqual({
    ok: true,
    overview: DREAMING,
    run: "waiting",
  });
});

it("answers a refusal with its status and an unknown intent as invalid", async () => {
  services.agentDreamingAdministration.saveSettings.mockRejectedValue(
    new AgentEmployeeError("forbidden"),
  );
  const refused = await post(dreamingAction, "agent-dreaming", {
    intent: "save-settings",
    agentId: "agent",
  });
  expect(refused.status).toBe(403);
  await expect(refused.json()).resolves.toEqual({
    ok: false,
    error: "forbidden",
  });
  services.agentDreamingAdministration.runNow.mockRejectedValue(
    new AgentEmployeeError("inactive"),
  );
  expect(
    (
      await post(dreamingAction, "agent-dreaming", {
        intent: "run-now",
        agentId: "agent",
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await post(dreamingAction, "agent-dreaming", {
        intent: "nope",
        agentId: "agent",
      })
    ).status,
  ).toBe(400);
});

it("reads and changes lessons and recipes, each answer carrying the overview as it stands", async () => {
  await expect(
    (await get(lessonsLoader, "agent-lessons")).json(),
  ).resolves.toEqual({ ok: true, overview: LESSONS });
  const lessons = services.agentLessonsAdministration;

  await post(lessonsAction, "agent-lessons", {
    intent: "save-lesson",
    agentId: "agent",
    lessonId: "l1",
    text: "Neu",
    evidence: "Beleg",
  });
  expect(lessons.saveLesson).toHaveBeenCalledWith(expect.anything(), "agent", {
    lessonId: "l1",
    text: "Neu",
    evidence: "Beleg",
  });
  await post(lessonsAction, "agent-lessons", {
    intent: "set-lesson-active",
    agentId: "agent",
    lessonId: "l1",
    active: "false",
  });
  expect(lessons.setLessonActive).toHaveBeenCalledWith(
    expect.anything(),
    "agent",
    { id: "l1", isActive: false },
  );
  await post(lessonsAction, "agent-lessons", {
    intent: "remove-lesson",
    agentId: "agent",
    lessonId: "l1",
  });
  expect(lessons.removeLesson).toHaveBeenCalledWith(
    expect.anything(),
    "agent",
    "l1",
  );

  await post(lessonsAction, "agent-lessons", {
    intent: "save-recipe",
    agentId: "agent",
    recipeId: "r1",
    name: "ticket-anlegen",
    summary: "s",
    keywords: "a,b",
    body: "",
    parameters: "[]",
    steps: "[]",
  });
  expect(lessons.saveRecipe).toHaveBeenCalledWith(expect.anything(), "agent", {
    recipeId: "r1",
    name: "ticket-anlegen",
    summary: "s",
    keywords: "a,b",
    body: "",
    parameters: "[]",
    steps: "[]",
  });
  await post(lessonsAction, "agent-lessons", {
    intent: "set-recipe-active",
    agentId: "agent",
    recipeId: "r1",
    active: "true",
  });
  expect(lessons.setRecipeActive).toHaveBeenCalledWith(
    expect.anything(),
    "agent",
    { id: "r1", isActive: true },
  );
  const removed = await post(lessonsAction, "agent-lessons", {
    intent: "remove-recipe",
    agentId: "agent",
    recipeId: "r1",
  });
  expect(lessons.removeRecipe).toHaveBeenCalledWith(
    expect.anything(),
    "agent",
    "r1",
  );
  await expect(removed.json()).resolves.toEqual({
    ok: true,
    overview: LESSONS,
  });
});

it("refuses an unknown intent and a failed change of lessons with the right status", async () => {
  expect(
    (
      await post(lessonsAction, "agent-lessons", {
        intent: "nope",
        agentId: "agent",
      })
    ).status,
  ).toBe(400);
  services.agentLessonsAdministration.saveRecipe.mockRejectedValue(
    new AgentEmployeeError("conflict"),
  );
  const conflict = await post(lessonsAction, "agent-lessons", {
    intent: "save-recipe",
    agentId: "agent",
  });
  expect(conflict.status).toBe(409);
  await expect(conflict.json()).resolves.toEqual({
    ok: false,
    error: "conflict",
  });
});

it("refuses every request without an account", async () => {
  const none = routeArguments(new Request("http://pages.invalid/x"), null, {});
  await expect(dreamingLoader(none)).rejects.toMatchObject({ status: 403 });
  await expect(lessonsLoader(none)).rejects.toMatchObject({ status: 403 });
});
