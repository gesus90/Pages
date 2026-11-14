import { vi } from "vitest";

import { sessionOverview } from "./agent-session-fixture";

import type { EndpointCall } from "./agent-session-fixture";
import type {
  AgentDreamRunView,
  AgentDreamingOverview,
  AgentDreamingResponse,
  AgentLessonView,
  AgentLessonsOverview,
  AgentLessonsResponse,
  AgentRecipeView,
} from "@/definition/AgentDreaming";

/** The text of `MEMORY.md` of the agent `ed`. */
export const MEMORY_TEXT = "# Memory\n- Igor prefers short answers.\n";

/** The text of `DREAM.md` of the agent `ed`. */
export const DREAM_TEXT = "# Lessons\n- Read the ticket first.\n";

/** A finished run; `overrides` change single fields. */
export function dreamRun(
  overrides: Partial<AgentDreamRunView> = {},
): AgentDreamRunView {
  return {
    at: "2026-11-13T12:00:00.000Z",
    status: "updated",
    trigger: "schedule",
    errorCode: null,
    counts: {
      memoryTaken: 3,
      memoryDropped: 1,
      lessonLearned: 1,
      lessonStrengthened: 0,
      lessonDropped: 0,
      recipeCreated: 0,
      recipeUpdated: 0,
      recipeDropped: 0,
    },
    log: [],
    ...overrides,
  };
}

/** The Dreaming of the agent `ed`; `overrides` change single fields. */
export function dreamingOverview(
  overrides: Partial<AgentDreamingOverview> = {},
): AgentDreamingOverview {
  return {
    agentId: "ed",
    agentName: "Ed",
    schedule: {
      isEnabled: true,
      interval: 1,
      unit: "days",
      time: null,
      weekday: null,
      isOnFullLogbook: true,
    },
    instanceTime: "03:00",
    model: null,
    ownModelLabel: "Claude Sonnet 5.5",
    models: [],
    nextRunAt: "2026-11-14T12:00:00.000Z",
    isRunning: false,
    isWaiting: false,
    lastRun: null,
    memory: { characters: 1234, limit: 8000 },
    dream: { characters: 2100, limit: 4000, lessons: 12 },
    logbook: { count: 124, fillPercent: 62, triggerPercent: 80 },
    files: { memory: MEMORY_TEXT, dream: DREAM_TEXT },
    canChange: true,
    ...overrides,
  };
}

/** A lesson of the agent `ed`; `overrides` change single fields. */
export function lessonView(
  id: string,
  overrides: Partial<AgentLessonView> = {},
): AgentLessonView {
  return {
    id,
    text: "Read the ticket before you ask questions.",
    evidence: "Three questions in PAGE-370 were answered in the ticket.",
    date: "2026-11-12",
    strength: 3,
    isActive: true,
    ...overrides,
  };
}

/** A flow recipe of the agent `ed`; `overrides` change single fields. */
export function flowRecipe(
  id: string,
  overrides: Partial<AgentRecipeView> = {},
): AgentRecipeView {
  return {
    id,
    name: "ticket_status",
    kind: "flow",
    summary: "Reads a ticket and sets its status.",
    keywords: ["ticket"],
    parameters: [{ name: "ticket", description: "The ticket key" }],
    steps: [
      {
        tool: "read_ticket",
        input: { key: "{{ticket}}" },
        note: "Read the ticket",
      },
      {
        tool: "set_ticket_status",
        input: { key: "{{ticket}}", status: "done" },
        note: "Close it",
      },
    ],
    body: "",
    evidence: "Done the same way four times.",
    date: "2026-11-12",
    strength: 2,
    useCount: 12,
    lastUsedAt: "2026-11-13T12:00:00.000Z",
    isActive: true,
    disabledReason: null,
    failureStreak: 0,
    lastError: null,
    origin: "dream",
    ...overrides,
  };
}

/** A knowledge recipe of the agent `ed`; `overrides` change single fields. */
export function knowledgeRecipe(
  id: string,
  overrides: Partial<AgentRecipeView> = {},
): AgentRecipeView {
  return {
    ...flowRecipe(id),
    name: "release_notes",
    kind: "knowledge",
    summary: "How release notes are written.",
    keywords: ["release", "notes"],
    parameters: [],
    steps: [],
    body: "Start with the user benefit.\nKeep it to five lines.",
    evidence: "Mei corrected the format twice.",
    strength: 1,
    useCount: 0,
    lastUsedAt: null,
    ...overrides,
  };
}

/** The lessons and recipes of the agent `ed`; `overrides` change single fields. */
export function lessonsOverview(
  overrides: Partial<AgentLessonsOverview> = {},
): AgentLessonsOverview {
  return {
    agentId: "ed",
    agentName: "Ed",
    lessons: [],
    recipes: [],
    dream: { characters: 2100, limit: 4000 },
    canChange: true,
    ...overrides,
  };
}

type Answer<Reply> = (call: EndpointCall) => Reply | Promise<Reply> | Response;

/** The answers of the two endpoints; one that is left out answers with an empty overview. */
interface DreamingEndpointAnswers {
  readonly dreaming?: Answer<AgentDreamingResponse>;
  readonly lessons?: Answer<AgentLessonsResponse>;
}

/** The requests the stubbed endpoints received, by endpoint. */
export interface DreamingEndpointCalls {
  readonly dreamingCalls: EndpointCall[];
  readonly lessonsCalls: EndpointCall[];
}

function formFields(body: unknown): Record<string, string> {
  if (!(body instanceof FormData)) return {};
  return Object.fromEntries(
    [...body.entries()].map(([name, value]) => [name, String(value)]),
  );
}

async function reply<Reply>(
  answer: Answer<Reply> | undefined,
  fallback: Reply,
  call: EndpointCall,
): Promise<Response> {
  const answered = answer === undefined ? fallback : await answer(call);
  return answered instanceof Response ? answered : Response.json(answered);
}

/**
 * Replaces `fetch` by the endpoints of Dreaming and of the lessons; the
 * sessions answer with an empty overview. Every call of the two endpoints is
 * recorded. Undo with `vi.unstubAllGlobals()`.
 */
export function stubDreamingEndpoints(
  answers: DreamingEndpointAnswers,
): DreamingEndpointCalls {
  const dreamingCalls: EndpointCall[] = [];
  const lessonsCalls: EndpointCall[] = [];
  vi.stubGlobal(
    "fetch",
    async (
      input: RequestInfo | URL,
      init: RequestInit = {},
    ): Promise<Response> => {
      const url = String(input);
      const call: EndpointCall = {
        url,
        method: init.method ?? "GET",
        headers: new Headers(init.headers),
        fields: formFields(init.body),
      };
      if (url.startsWith("/chat-page-api/agent-dreaming")) {
        dreamingCalls.push(call);
        return reply(
          answers.dreaming,
          { ok: true, overview: dreamingOverview() },
          call,
        );
      }
      if (url.startsWith("/chat-page-api/agent-lessons")) {
        lessonsCalls.push(call);
        return reply(
          answers.lessons,
          { ok: true, overview: lessonsOverview() },
          call,
        );
      }
      return Response.json({ ok: true, overview: sessionOverview() });
    },
  );
  return { dreamingCalls, lessonsCalls };
}
