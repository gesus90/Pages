import { z } from "zod";

import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { countCharacters } from "@/definition/AgentMemory";

import {
  lessonId,
  mergeDreamLessons,
  parseDreamDocument,
  renderDreamDocument,
} from "./AgentDreamDocument";
import { checkRecipeDraft } from "./AgentRecipeRules";

import type { StoredAgentRecipe } from "@/backend/database/repositories/employee/AgentRecipeRepository";
import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { UserRepository } from "@/backend/database/repositories/UserRepository";
import type {
  AgentLessonView,
  AgentLessonsOverview,
  AgentRecipeView,
} from "@/definition/AgentDreaming";
import type { User } from "@/definition/User";
import type { AgentChatSessionViewer } from "./AgentChatSessionService";
import type { AgentDreamLesson } from "./AgentDreamDocument";
import type { AgentMemoryService } from "./AgentMemoryService";

/** What the tab "Lektionen & Rezepte" is read and changed with. */
export interface AgentLessonsAdministrationDependencies {
  readonly store: Pick<EmployeeStore, "employees" | "recipes">;
  readonly users: Pick<UserRepository, "findById">;
  readonly memory: Pick<AgentMemoryService, "saveDream">;
  readonly now?: () => Date;
}

/** Parses a field that holds JSON; a text that is none stays absent so the schema refuses it. */
function jsonField(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

const lessonInput = z.object({
  lessonId: z.string().min(1).max(100),
  text: z.string().trim().min(1).max(1_000),
  evidence: z.string().trim().min(1).max(1_000),
});

const recipeInput = z.object({
  recipeId: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(100),
  summary: z.string().max(1_000),
  keywords: z.string().max(1_000).default(""),
  body: z.string().max(10_000).default(""),
  parameters: z.preprocess(
    jsonField,
    z
      .array(
        z.object({
          name: z.string().max(100),
          description: z.string().max(1_000).default(""),
        }),
      )
      .max(30)
      .default([]),
  ),
  steps: z.preprocess(
    jsonField,
    z
      .array(
        z.object({
          tool: z.string().max(200),
          input: z.record(z.string(), z.unknown()),
          note: z.string().max(1_000).default(""),
        }),
      )
      .max(30)
      .default([]),
  ),
});

const idInput = z.string().min(1).max(100);

/** An identifier from a form, or the refusal of a malformed one. */
function requireId(value: unknown): string {
  const parsed = idInput.safeParse(value);
  if (!parsed.success) throw new AgentEmployeeError("invalidInput");
  return parsed.data;
}

function lessonView(lesson: AgentDreamLesson): AgentLessonView {
  return {
    id: lessonId(lesson.text),
    text: lesson.text,
    evidence: lesson.evidence,
    date: lesson.date,
    strength: lesson.strength,
    isActive: lesson.isActive,
  };
}

function recipeView(recipe: StoredAgentRecipe): AgentRecipeView {
  return {
    id: recipe.id,
    name: recipe.name,
    kind: recipe.kind,
    summary: recipe.summary,
    keywords: recipe.keywords,
    parameters: recipe.parameters,
    steps: recipe.steps,
    body: recipe.body,
    evidence: recipe.evidence,
    date: recipe.confirmedOn,
    strength: recipe.strength,
    useCount: recipe.useCount,
    lastUsedAt: recipe.lastUsedAt,
    isActive: recipe.isActive,
    disabledReason: recipe.disabledReason,
    failureStreak: recipe.failureStreak,
    lastError: recipe.lastError,
    origin: recipe.origin,
  };
}

/**
 * The tab "Lektionen & Rezepte" of the agent settings (PAGE-378): the lessons
 * of `DREAM.md` and the recipes of an agent to view, edit, switch off and delete.
 *
 * @remarks
 * Lessons and recipes hold what the agent learned from the chats of its
 * people, so only an administrator reads and changes them. A lesson that is
 * off stays in `DREAM.md` but is not loaded into a session; a recipe that is
 * off is not run and not listed to the agent. Whatever is saved takes effect
 * at once.
 */
export class AgentLessonsAdministration {
  private readonly dependencies: AgentLessonsAdministrationDependencies;

  public constructor(dependencies: AgentLessonsAdministrationDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Reads the lessons and recipes of an agent; for a viewer who is no
   * administrator both lists are empty.
   *
   * @throws {AgentEmployeeError} `notFound` for an account that is no agent.
   */
  public async overview(
    viewer: AgentChatSessionViewer,
    agentId: string,
  ): Promise<AgentLessonsOverview> {
    const agent = await this.requireAgent(agentId);
    const employee = await this.dependencies.store.employees().find(agentId);
    if (!employee) throw new AgentEmployeeError("notFound");
    const dream = {
      characters: countCharacters(employee.dream),
      limit: employee.dreamCharacters,
    };
    if (!viewer.isAdministrator) return this.empty(agent, dream);
    const recipes = await this.dependencies.store.recipes().list(agentId);
    return {
      agentId,
      agentName: agent.displayName,
      lessons: parseDreamDocument(employee.dream, this.today()).map(lessonView),
      recipes: recipes.map(recipeView),
      dream,
      canChange: true,
    };
  }

  /**
   * Replaces the text and the evidence of a lesson.
   *
   * @throws {AgentEmployeeError} `forbidden` for a viewer who is no
   * administrator, `invalidInput` for an empty or too long text, `notFound`
   * for a lesson that is gone.
   */
  public async saveLesson(
    viewer: AgentChatSessionViewer,
    agentId: string,
    input: unknown,
  ): Promise<void> {
    const parsed = lessonInput.safeParse(input);
    await this.requireAdministrator(viewer, agentId);
    if (!parsed.success) throw new AgentEmployeeError("invalidInput");
    await this.changeLessons(agentId, (lessons) =>
      this.replaceLesson(lessons, parsed.data.lessonId, (lesson) => ({
        ...lesson,
        text: parsed.data.text,
        evidence: parsed.data.evidence,
      })),
    );
  }

  /**
   * Switches a lesson on or off.
   *
   * @throws {AgentEmployeeError} `forbidden` for a viewer who is no
   * administrator, `notFound` for a lesson that is gone.
   */
  public async setLessonActive(
    viewer: AgentChatSessionViewer,
    agentId: string,
    lesson: { readonly id: string; readonly isActive: boolean },
  ): Promise<void> {
    await this.requireAdministrator(viewer, agentId);
    await this.changeLessons(agentId, (lessons) =>
      this.replaceLesson(lessons, lesson.id, (entry) => ({
        ...entry,
        isActive: lesson.isActive,
      })),
    );
  }

  /**
   * Deletes a lesson.
   *
   * @throws {AgentEmployeeError} `forbidden` for a viewer who is no
   * administrator, `notFound` for a lesson that is gone.
   */
  public async removeLesson(
    viewer: AgentChatSessionViewer,
    agentId: string,
    id: string,
  ): Promise<void> {
    await this.requireAdministrator(viewer, agentId);
    await this.changeLessons(agentId, (lessons) => {
      const rest = lessons.filter((lesson) => lessonId(lesson.text) !== id);
      return rest.length === lessons.length ? null : rest;
    });
  }

  /**
   * Saves an edited recipe. The kind stays; a flow recipe is checked like one of
   * the dream run, so a step with a deleting tool or a confirmation is refused.
   *
   * @throws {AgentEmployeeError} `forbidden` for a viewer who is no
   * administrator, `invalidInput` for a recipe that does not pass the check,
   * `conflict` for a name another recipe has, `notFound` for a recipe that is gone.
   */
  public async saveRecipe(
    viewer: AgentChatSessionViewer,
    agentId: string,
    input: unknown,
  ): Promise<void> {
    await this.requireAdministrator(viewer, agentId);
    const parsed = recipeInput.safeParse(input);
    if (!parsed.success) throw new AgentEmployeeError("invalidInput");
    const recipes = this.dependencies.store.recipes();
    const existing = await recipes.findById(agentId, parsed.data.recipeId);
    if (!existing) throw new AgentEmployeeError("notFound");
    const checked = checkRecipeDraft(
      {
        name: parsed.data.name,
        kind: existing.kind,
        summary: parsed.data.summary,
        keywords: parsed.data.keywords.split(","),
        parameters: parsed.data.parameters,
        steps: parsed.data.steps,
        body: parsed.data.body,
        evidence: existing.evidence,
      },
      {
        today: existing.confirmedOn,
        strength: existing.strength,
        knownTools: null,
      },
    );
    if (!checked.isValid) throw new AgentEmployeeError("invalidInput");
    const same = await recipes.findByName(agentId, checked.content.name);
    if (same && same.id !== existing.id)
      throw new AgentEmployeeError("conflict");
    await recipes.update(agentId, existing.id, checked.content, {
      reactivate: false,
    });
  }

  /**
   * Switches a recipe on or off; switching it on resets its failures.
   *
   * @throws {AgentEmployeeError} `forbidden` for a viewer who is no
   * administrator, `notFound` for a recipe that is gone.
   */
  public async setRecipeActive(
    viewer: AgentChatSessionViewer,
    agentId: string,
    recipe: { readonly id: string; readonly isActive: boolean },
  ): Promise<void> {
    await this.requireAdministrator(viewer, agentId);
    const isFound = await this.dependencies.store
      .recipes()
      .setActive(agentId, requireId(recipe.id), recipe.isActive);
    if (!isFound) throw new AgentEmployeeError("notFound");
  }

  /**
   * Deletes a recipe.
   *
   * @throws {AgentEmployeeError} `forbidden` for a viewer who is no
   * administrator, `notFound` for a recipe that is gone.
   */
  public async removeRecipe(
    viewer: AgentChatSessionViewer,
    agentId: string,
    id: string,
  ): Promise<void> {
    await this.requireAdministrator(viewer, agentId);
    const removed = await this.dependencies.store
      .recipes()
      .remove(agentId, [requireId(id)]);
    if (removed === 0) throw new AgentEmployeeError("notFound");
  }

  private empty(
    agent: User,
    dream: AgentLessonsOverview["dream"],
  ): AgentLessonsOverview {
    return {
      agentId: agent.id,
      agentName: agent.displayName,
      lessons: [],
      recipes: [],
      dream,
      canChange: false,
    };
  }

  /** Replaces one lesson by its identifier; `null` when none has it. */
  private replaceLesson(
    lessons: readonly AgentDreamLesson[],
    id: string,
    change: (lesson: AgentDreamLesson) => AgentDreamLesson,
  ): AgentDreamLesson[] | null {
    if (!lessons.some((lesson) => lessonId(lesson.text) === id)) return null;
    return lessons.map((lesson) =>
      lessonId(lesson.text) === id ? change(lesson) : lesson,
    );
  }

  /** Saves `DREAM.md` with the changed lessons, within its limit. */
  private async changeLessons(
    agentId: string,
    change: (
      lessons: readonly AgentDreamLesson[],
    ) => readonly AgentDreamLesson[] | null,
  ): Promise<void> {
    const employee = await this.dependencies.store.employees().find(agentId);
    if (!employee) throw new AgentEmployeeError("notFound");
    const changed = change(parseDreamDocument(employee.dream, this.today()));
    if (changed === null) throw new AgentEmployeeError("notFound");
    const fitted = mergeDreamLessons(changed, [], employee.dreamCharacters);
    await this.dependencies.memory.saveDream(
      agentId,
      renderDreamDocument(fitted.lessons),
    );
  }

  private async requireAdministrator(
    viewer: AgentChatSessionViewer,
    agentId: string,
  ): Promise<void> {
    if (!viewer.isAdministrator) throw new AgentEmployeeError("forbidden");
    await this.requireAgent(agentId);
  }

  private async requireAgent(agentId: string): Promise<User> {
    const agent = await this.dependencies.users.findById(agentId);
    if (agent?.isAgent !== true) throw new AgentEmployeeError("notFound");
    return agent;
  }

  private today(): string {
    return (this.dependencies.now?.() ?? new Date()).toISOString().slice(0, 10);
  }
}
