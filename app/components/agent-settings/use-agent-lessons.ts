import { useEffect, useRef, useState } from "react";

import {
  readAgentLessonsOverview,
  sendAgentLessonsRequest,
} from "./agent-lessons-api";
import { lessonsRequestKey } from "./agent-lessons-display";

import type {
  AgentLessonsRequest,
  AgentRecipeInput,
} from "./agent-lessons-api";
import type {
  AgentDreamingFailure,
  AgentLessonsOverview,
} from "@/definition/AgentDreaming";

/** What the tab "Lektionen & Rezepte" knows and can do for one agent. */
export interface AgentLessonsState {
  /** The overview of the last read or change; `null` before the first answer. */
  readonly overview: AgentLessonsOverview | null;
  /** Why the overview could not be read; `null` when it was. */
  readonly loadFailure: AgentDreamingFailure | null;
  /** The key of the change that runs now (see `lessonsRequestKey`); `null` while idle. */
  readonly pendingKey: string | null;
  /** Why the last change was refused; `null` when it worked or none ran. */
  readonly failure: AgentDreamingFailure | null;
  /** Reads the overview again after a failure. */
  reload(): void;
  /** Saves the text and the evidence of a lesson; resolves to whether it was accepted. */
  saveLesson(
    lessonId: string,
    text: string,
    evidence: string,
  ): Promise<boolean>;
  /** Switches a lesson on or off; resolves to whether it was accepted. */
  setLessonActive(lessonId: string, isActive: boolean): Promise<boolean>;
  /** Deletes a lesson; resolves to whether it was accepted. */
  removeLesson(lessonId: string): Promise<boolean>;
  /** Saves a recipe; resolves to whether it was accepted. */
  saveRecipe(recipe: AgentRecipeInput): Promise<boolean>;
  /** Switches a recipe on or off; resolves to whether it was accepted. */
  setRecipeActive(recipeId: string, isActive: boolean): Promise<boolean>;
  /** Deletes a recipe; resolves to whether it was accepted. */
  removeRecipe(recipeId: string): Promise<boolean>;
}

/**
 * Reads the lessons and recipes of an agent and changes them (PAGE-378).
 *
 * @remarks
 * Every answer of a change carries the fresh overview, which replaces the
 * shown one; nothing is merged on the client. A change the server refuses as a
 * conflict, because a dream run changed the same entry meanwhile, is followed
 * by a fresh read so that the list shows what is there now.
 *
 * @param agentId - The agent whose lessons and recipes the tab shows.
 */
export function useAgentLessons(agentId: string): AgentLessonsState {
  const [overview, setOverview] = useState<AgentLessonsOverview | null>(null);
  const [loadFailure, setLoadFailure] = useState<AgentDreamingFailure | null>(
    null,
  );
  const [reloadKey, setReloadKey] = useState(0);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [failure, setFailure] = useState<AgentDreamingFailure | null>(null);
  // Two clicks inside one render must not send two changes.
  const isSending = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setOverview(null);
    setLoadFailure(null);
    void readAgentLessonsOverview(agentId, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        if (response.ok) setOverview(response.overview);
        else setLoadFailure(response.error);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.warn("[pages] The lessons could not be read.", error);
        setLoadFailure("unavailable");
      });
    return () => controller.abort();
  }, [agentId, reloadKey]);

  async function refresh(): Promise<void> {
    try {
      const response = await readAgentLessonsOverview(
        agentId,
        new AbortController().signal,
      );
      if (response.ok) setOverview(response.overview);
    } catch (error: unknown) {
      console.warn("[pages] The lessons could not be read again.", error);
    }
  }

  async function run(request: AgentLessonsRequest): Promise<boolean> {
    if (isSending.current) return false;
    isSending.current = true;
    setPendingKey(lessonsRequestKey(request));
    setFailure(null);
    try {
      const response = await sendAgentLessonsRequest(request);
      if (response.ok) {
        setOverview(response.overview);
        return true;
      }
      setFailure(response.error);
      if (response.error === "conflict") await refresh();
      return false;
    } catch (error: unknown) {
      console.warn("[pages] The lessons request failed.", error);
      setFailure("unavailable");
      return false;
    } finally {
      isSending.current = false;
      setPendingKey(null);
    }
  }

  return {
    overview,
    loadFailure,
    pendingKey,
    failure,
    reload: () => setReloadKey((key) => key + 1),
    saveLesson: (lessonId, text, evidence) =>
      run({ intent: "save-lesson", agentId, lessonId, text, evidence }),
    setLessonActive: (lessonId, isActive) =>
      run({ intent: "set-lesson-active", agentId, lessonId, isActive }),
    removeLesson: (lessonId) =>
      run({ intent: "remove-lesson", agentId, lessonId }),
    saveRecipe: (recipe) => run({ intent: "save-recipe", agentId, recipe }),
    setRecipeActive: (recipeId, isActive) =>
      run({ intent: "set-recipe-active", agentId, recipeId, isActive }),
    removeRecipe: (recipeId) =>
      run({ intent: "remove-recipe", agentId, recipeId }),
  };
}
