import { useEffect, useMemo } from "react";

import { useDraftStores } from "@/app/components/common/draft-provider";
import { wikiPagePath } from "@/app/lib/wiki-tree";
import { wikiSaveContentSchema } from "@/definition/BackgroundSave";

import type { DraftEntry } from "@/app/lib/drafts/draft-queue";
import type { WikiSaveContent } from "@/definition/BackgroundSave";
import type { WikiPage } from "@/definition/Wiki";

/** What the editor shows about the save. */
export type WikiSaveStatus =
  | "saved"
  | "saving"
  | "unsaved"
  | "conflict"
  | "error"
  | "tooLong"
  | "titleRequired";

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
  readonly errorCode: string | null;
  /** The way out of a conflict, while one is open. */
  readonly conflict: WikiConflict | null;
  /** Saves now instead of waiting for the delay. */
  readonly saveNow: () => void;
  /** True when everything typed is saved. */
  readonly isClean: boolean;
  /** The page as last saved, or as loaded while nothing was saved. */
  readonly saved: WikiPage;
  /**
   * Takes over a newer saved version, such as a restored one, while nothing
   * typed is unsaved.
   */
  readonly adopt: (page: WikiPage) => boolean;
}

/** Retains the wiki draft and its writes above route lifetimes. */
export function useWikiDraft(page: WikiPage): WikiDraftState {
  const { wiki } = useDraftStores();
  const entry = wiki.open({
    id: page.id,
    href: wikiPagePath(page.id, page.title),
    label: page.title,
    saved: wikiSaveContentSchema.parse(page),
  });
  const saved = useMemo(() => {
    if (page.revision === entry.base.revision) return page;
    return { ...page, ...entry.base };
  }, [page, entry.base]);
  const current = entry.current ? { ...page, ...entry.current } : null;

  useEffect(() => {
    if (page.revision > entry.base.revision) {
      wiki.adopt(page.id, wikiSaveContentSchema.parse(page));
    }
  }, [wiki, page, entry.base.revision]);

  return {
    draft: {
      title: entry.draft.title,
      content: entry.draft.content,
      icon: entry.draft.icon ?? "",
    },
    saved,
    isClean: !entry.hasChanges && !entry.isSaving,
    errorCode: entry.error,
    status: resolveStatus(entry),
    saveNow: () => wiki.save(page.id),
    setDraft: (next) =>
      wiki.change(page.id, {
        ...entry.draft,
        ...next,
        icon: next.icon.trim() || null,
      }),
    conflict: current
      ? {
          theirs: current,
          keepMine: () => wiki.resolve(page.id, "mine"),
          takeTheirs: () => wiki.resolve(page.id, "theirs"),
        }
      : null,
    adopt: (next) =>
      next.revision > entry.base.revision &&
      wiki.adopt(page.id, wikiSaveContentSchema.parse(next)),
  };
}

function resolveStatus(entry: DraftEntry<WikiSaveContent>): WikiSaveStatus {
  if (entry.current) return "conflict";
  if (entry.error === "titleRequired" || entry.error === "tooLong")
    return entry.error;
  if (entry.error) return "error";
  if (entry.isSaving) return "saving";
  return entry.hasChanges ? "unsaved" : "saved";
}
