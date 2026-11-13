import { vi } from "vitest";

import {
  parseMemoryDocument,
  renderMemoryDocument,
} from "@/backend/service/employee/AgentMemoryDocument";
import {
  AgentLearningService,
  type AgentLearningDependencies,
} from "@/backend/service/employee/AgentLearningService";
import { AGENT_DREAM_DEFAULT_SCHEDULE } from "@/definition/AgentDreaming";

import { AGENT, FakeRecipes } from "./page378-recipe-fixture";

import type { StoredAgentEmployee } from "@/backend/database/repositories/employee/AgentEmployeeRepository";
import type { StoredAgentDreaming } from "@/backend/database/repositories/employee/AgentDreamingRepository";
import type { StoredAgentLogbookEntry } from "@/backend/database/repositories/employee/AgentLogbookRepository";
import type { AgentLearningSource } from "@/backend/database/repositories/employee/AgentLearningSourceRepository";
import type { AgentDreamAnswer } from "@/backend/service/employee/AgentLearningPrompt";
import type { AgentMemoryDocument } from "@/backend/service/employee/AgentMemoryDocument";
import { partialStub } from "../../stub-fixture";

export { AGENT };

export const NOW = new Date("2026-11-13T02:00:00.000Z");

/** An entry of the Lagebuch from the direct chat with Igor. */
export function entry(
  sequence: number,
  overrides: Partial<StoredAgentLogbookEntry> = {},
): StoredAgentLogbookEntry {
  return {
    id: `entry-${String(sequence)}`,
    sequence,
    agentId: AGENT,
    kind: "decision",
    text: "Release ist am Freitag.",
    topic: "Release",
    source: { kind: "direct", id: "igor", name: "Igor" },
    participants: ["Igor"],
    origin: "agent",
    createdAt: "2026-11-12T10:00:00.000Z",
    ...overrides,
  };
}

/** What a model answers when it has nothing to say. */
export const EMPTY_ANSWER: AgentDreamAnswer = {
  topics: [],
  discarded: [],
  lessons: [],
  recipes: [],
  dropRecipes: [],
};

export interface DreamWorld {
  readonly service: AgentLearningService;
  readonly employee: { value: StoredAgentEmployee };
  readonly dreaming: { value: StoredAgentDreaming };
  readonly recipes: FakeRecipes;
  readonly logbook: { entries: StoredAgentLogbookEntry[] };
  readonly sources: { entries: AgentLearningSource[] };
  readonly model: { dream: ReturnType<typeof vi.fn> };
  readonly saved: {
    learning: unknown[];
    runs: Record<string, unknown>[];
    requests: unknown[];
  };
  readonly isWorking: { value: boolean };
  /** The clock of the run; tests move it. */
  readonly clock: { value: Date };
  readonly activity: { recordLearning: ReturnType<typeof vi.fn> };
  /** The MEMORY.md of the agent as a document. */
  memory(): AgentMemoryDocument;
}

/** The employee of the dream run as it is stored before any run. */
function freshEmployee(): StoredAgentEmployee {
  return {
    userId: AGENT,
    connectionId: "conn",
    model: "model",
    reasoningEffort: null,
    access: "read_only",
    soul: "",
    instructions: "",
    memory: "",
    isLearningEnabled: true,
    learningIntervalHours: 12,
    learnedThrough: null,
    lastLearningAt: null,
    lastLearningResult: null,
    revision: 1,
    createdAt: "2026-11-01 10:00:00",
    updatedAt: "2026-11-01 10:00:00",
    voiceId: null,
    voiceSpeedTenths: 10,
    dream: "",
    memoryCharacters: 8_000,
    dreamCharacters: 4_000,
    dreamSchedule: AGENT_DREAM_DEFAULT_SCHEDULE,
    dreamRequest: null,
  };
}

/** The dreaming settings of the agent as they are stored before any run. */
function freshDreaming(): StoredAgentDreaming {
  return {
    agentId: AGENT,
    schedule: AGENT_DREAM_DEFAULT_SCHEDULE,
    model: null,
    lastRunAt: null,
    createdAt: "2026-11-01 10:00:00",
    request: null,
    logbookThrough: 0,
    toolsThrough: 0,
    lastRun: null,
  };
}

/** The in-memory state the store of a dream world reads and writes. */
interface DreamStoreParts {
  readonly employee: { value: StoredAgentEmployee };
  readonly dreaming: { value: StoredAgentDreaming };
  readonly saved: DreamWorld["saved"];
  readonly logbook: { entries: StoredAgentLogbookEntry[] };
  readonly sources: { entries: AgentLearningSource[] };
  readonly recipes: FakeRecipes;
}

/** The store of a dream world: the employee, the dreaming settings, the Lagebuch, sources and recipes. */
function dreamStore(
  parts: DreamStoreParts,
): AgentLearningDependencies["store"] {
  const { employee, dreaming, saved, logbook, sources } = parts;
  const recipeStore = parts.recipes.store();
  return partialStub<AgentLearningDependencies["store"]>({
    employees: () => ({
      find: async () => employee.value,
      saveLearning: async (
        agent: string,
        record: { learnedThrough: string | null; lastLearningAt: string },
      ) => {
        saved.learning.push(record);
        employee.value = {
          ...employee.value,
          lastLearningAt: record.lastLearningAt,
          learnedThrough:
            record.learnedThrough ?? employee.value.learnedThrough,
        };
      },
    }),
    dreaming: () => ({
      find: async () => dreaming.value,
      saveRun: async (
        agent: string,
        record: {
          run: Record<string, unknown>;
          logbookThrough: number | null;
          toolsThrough: number | null;
        },
      ) => {
        saved.runs.push(record.run);
        dreaming.value = {
          ...dreaming.value,
          logbookThrough:
            record.logbookThrough ?? dreaming.value.logbookThrough,
          toolsThrough: record.toolsThrough ?? dreaming.value.toolsThrough,
          request: null,
        };
        employee.value = { ...employee.value, dreamRequest: null };
      },
      saveRequest: async (
        agent: string,
        request: { at: string; trigger: "manual" | "logbook" },
      ) => {
        saved.requests.push(request);
        employee.value = { ...employee.value, dreamRequest: request };
      },
    }),
    sources: () => ({ read: async () => sources.entries }),
    logbook: () => ({
      forDreaming: async (
        agent: string,
        window: { after: number; limit: number },
      ) =>
        logbook.entries
          .filter((candidate) => candidate.sequence > window.after)
          .slice(0, window.limit),
    }),
    toolUses: () => recipeStore.toolUses(),
    recipes: () => recipeStore.recipes(),
    sessionSettings: () => ({ read: async () => ({ dreamTime: "03:00" }) }),
  });
}

/** The memory of the agent as the dream run changes it; the employee holds the text. */
function memoryPort(employee: {
  value: StoredAgentEmployee;
}): AgentLearningDependencies["memory"] {
  return {
    saveDream: vi.fn(async (agent: string, dream: string) => {
      employee.value = { ...employee.value, dream };
    }),
    updateMemory: vi.fn(
      async (
        agent: string,
        change: (current: AgentMemoryDocument) => {
          document: AgentMemoryDocument;
          finished: readonly unknown[];
        },
      ) => {
        const changed = change(parseMemoryDocument(employee.value.memory));
        employee.value = {
          ...employee.value,
          memory: renderMemoryDocument(changed.document),
        };
        return changed.finished.length;
      },
    ),
  };
}

/** A world of one agent for the dream run: an in-memory store, a model that answers as told, a clock. */
export function dreamWorld(
  answer: AgentDreamAnswer | null = EMPTY_ANSWER,
): DreamWorld {
  const employee = { value: freshEmployee() };
  const dreaming = { value: freshDreaming() };
  const recipes = new FakeRecipes();
  const logbook = { entries: [] as StoredAgentLogbookEntry[] };
  const sources = { entries: [] as AgentLearningSource[] };
  const saved: DreamWorld["saved"] = { learning: [], runs: [], requests: [] };
  const isWorking = { value: false };
  const clock = { value: NOW };
  const activity = { recordLearning: vi.fn(async () => undefined) };
  const model = { dream: vi.fn(async () => answer) };
  const service = new AgentLearningService({
    store: dreamStore({ employee, dreaming, saved, logbook, sources, recipes }),
    users: {
      findById: async () =>
        partialStub<never>({
          id: AGENT,
          displayName: "Ed",
          isAgent: true,
          isActive: true,
        }),
    },
    memory: memoryPort(employee),
    model: model as never,
    activity: activity as never,
    isWorkingInChat: () => isWorking.value,
    now: () => clock.value,
    createId: (() => {
      let counter = 0;
      return () => `id-${String((counter += 1))}`;
    })(),
  });
  return {
    service,
    employee,
    dreaming,
    recipes,
    logbook,
    sources,
    model,
    saved,
    isWorking,
    clock,
    activity,
    memory: () => parseMemoryDocument(employee.value.memory),
  };
}
