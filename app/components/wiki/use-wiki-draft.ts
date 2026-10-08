import { useEffect, useState } from "react";
import { useFetcher } from "react-router";

import {
  countCharacters,
  normalizeWikiTitle,
  WIKI_LIMITS,
} from "@/definition/Wiki";

import type {
  WikiActionErrorCode,
  WikiActionResult,
} from "@/app/lib/wiki-actions/wiki-action-support.server";
import type { WikiPage } from "@/definition/Wiki";

/** Milliseconds without typing before a draft is saved. */
const AUTOSAVE_DELAY = 1200;

/** What the editor shows about the save. */
export type WikiSaveStatus =
  "saved" | "saving" | "unsaved" | "conflict" | "error" | "tooLong";

/** The fields the person edits. */
export interface WikiDraft {
  readonly title: string;
  readonly content: string;
  readonly icon: string;
}

/** A save that lost against somebody else's, with the ways out. */
export interface WikiConflict {
  /** The page as somebody else saved it. */
  readonly theirs: WikiPage;
  /** Keeps the draft and saves it on top of the newer revision. */
  readonly keepMine: () => void;
  /** Replaces the draft with the other version. */
  readonly takeTheirs: () => void;
}

/** The draft of a page, its autosave and the way out of a conflict. */
export interface WikiDraftState {
  readonly draft: WikiDraft;
  readonly setDraft: (draft: WikiDraft) => void;
  readonly status: WikiSaveStatus;
  readonly errorCode: WikiActionErrorCode | null;
  /** The way out of a conflict, while one is open. */
  readonly conflict: WikiConflict | null;
  /** Saves now instead of waiting for the delay. */
  readonly saveNow: () => void;
  /** True when everything typed is saved. */
  readonly isClean: boolean;
  /** The page as last saved, or as loaded while nothing was saved. */
  readonly saved: WikiPage;
}

function createSaveRequest(save: {
  readonly pageId: string;
  readonly revision: number;
  readonly title: string;
  readonly icon: string | null;
  readonly content: string;
}): Record<string, string> {
  return {
    content: save.content,
    expectedRevision: String(save.revision),
    icon: save.icon ?? "",
    intent: "save",
    title: save.title,
  };
}

function toIcon(icon: string): string | null {
  const trimmed = icon.trim();

  return trimmed === "" ? null : trimmed;
}

/**
 * Holds the draft of a page and saves it against its revision.
 *
 * @param page - The page as loaded.
 * @returns The draft, its status and the controls of the editor.
 *
 * @remarks
 * The draft is saved a moment after the last keystroke. Saving sends the
 * revision the draft is based on; when somebody else saved in between, the
 * server answers with a conflict and the person chooses whose text to keep.
 */
export function useWikiDraft(page: WikiPage): WikiDraftState {
  const fetcher = useFetcher<WikiActionResult<{ page: WikiPage }>>();
  const [draft, setDraftState] = useState<WikiDraft>({
    content: page.content,
    icon: page.icon ?? "",
    title: page.title,
  });
  const [base, setBase] = useState(page);
  const [conflict, setConflict] = useState<WikiPage | null>(null);
  const [errorCode, setErrorCode] = useState<WikiActionErrorCode | null>(null);
  const title = normalizeWikiTitle(draft.title);
  const icon = toIcon(draft.icon);
  const isClean =
    title === base.title &&
    draft.content === base.content &&
    icon === base.icon;
  const isTooLong =
    countCharacters(title) > WIKI_LIMITS.titleLength ||
    countCharacters(draft.content) > WIKI_LIMITS.contentLength;
  const isIdle = fetcher.state === "idle";
  const canSave =
    !isClean &&
    !isTooLong &&
    title !== "" &&
    conflict === null &&
    errorCode === null;
  const result = fetcher.data;
  const submit = fetcher.submit;

  const pageId = page.id;
  const revision = base.revision;
  const content = draft.content;

  useEffect(() => {
    if (!result) {
      return;
    }

    if (result.ok) {
      setBase(result.page);
      setErrorCode(null);
    } else if (result.current) {
      setConflict(result.current);
    } else {
      setErrorCode(result.error);
    }
  }, [result]);

  useEffect(() => {
    if (!canSave || !isIdle) {
      return undefined;
    }

    const timer = setTimeout(() => {
      void submit(
        createSaveRequest({ content, icon, pageId, revision, title }),
        { action: `/wiki/${pageId}`, method: "post" },
      );
    }, AUTOSAVE_DELAY);

    return () => clearTimeout(timer);
  }, [canSave, content, icon, isIdle, pageId, revision, submit, title]);

  return {
    conflict: conflict
      ? {
          keepMine: () => {
            setBase(conflict);
            setConflict(null);
          },
          takeTheirs: () => {
            setDraftState({
              content: conflict.content,
              icon: conflict.icon ?? "",
              title: conflict.title,
            });
            setBase(conflict);
            setConflict(null);
          },
          theirs: conflict,
        }
      : null,
    draft,
    errorCode,
    isClean,
    saved: base,
    saveNow: () => {
      if (canSave && isIdle) {
        void submit(
          createSaveRequest({ content, icon, pageId, revision, title }),
          { action: `/wiki/${pageId}`, method: "post" },
        );
      }
    },
    setDraft: (next) => {
      setErrorCode(null);
      setDraftState(next);
    },
    status: resolveStatus({ conflict, errorCode, isClean, isIdle, isTooLong }),
  };
}

function resolveStatus(facts: {
  readonly conflict: WikiPage | null;
  readonly errorCode: WikiActionErrorCode | null;
  readonly isClean: boolean;
  readonly isIdle: boolean;
  readonly isTooLong: boolean;
}): WikiSaveStatus {
  if (facts.conflict) {
    return "conflict";
  }

  if (facts.errorCode) {
    return "error";
  }

  if (facts.isTooLong) {
    return "tooLong";
  }

  if (!facts.isIdle) {
    return "saving";
  }

  return facts.isClean ? "saved" : "unsaved";
}
