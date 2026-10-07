import { useEffect, useState } from "react";
import { useFetcher, useSearchParams } from "react-router";

import {
  normalizeBoardPreferences,
  parseBoardQuery,
  withBoardQuery,
} from "@/definition/BoardPreferences";

import type { BoardPreferences } from "@/definition/BoardPreferences";

/** How long the board waits after the last change before it saves the view. */
const SAVE_DELAY_MS = 600;

/** The board view of the visitor and the function that changes it. */
export interface BoardPreferencesState {
  readonly preferences: BoardPreferences;
  /** The text of the search field, which follows the typing without a delay. */
  readonly searchText: string;
  readonly update: (patch: Partial<BoardPreferences>) => void;
}

/**
 * Keeps the board view in the address and saves it for the visitor.
 *
 * @remarks
 * The address is the truth: it carries every preference after the first
 * change, so a copied address shows the same board. The loader resolved the
 * preferences of the first visit from the address or the saved view; they fill
 * what the address does not carry. A change replaces the address instead of
 * adding a history entry and is saved in the background after a short pause,
 * so typing in the search field neither fills the history nor blocks the page.
 *
 * @param initial - The preferences the loader resolved.
 */
export function useBoardPreferences(
  initial: BoardPreferences,
): BoardPreferencesState {
  const [searchParams, setSearchParams] = useSearchParams();
  const { submit } = useFetcher();
  const preferences = parseBoardQuery(searchParams, initial);
  const [searchText, setSearchText] = useState(preferences.search);
  const [unsaved, setUnsaved] = useState<BoardPreferences | null>(null);

  useEffect(() => {
    if (unsaved === null) {
      return undefined;
    }

    const timer = setTimeout(() => {
      void submit(
        {
          intent: "save-board-preferences",
          preferences: JSON.stringify(unsaved),
        },
        { method: "post" },
      );
      setUnsaved(null);
    }, SAVE_DELAY_MS);

    return () => clearTimeout(timer);
  }, [unsaved, submit]);

  function update(patch: Partial<BoardPreferences>): void {
    const next = normalizeBoardPreferences({ ...preferences, ...patch });

    if (patch.search !== undefined) {
      setSearchText(patch.search);
    }

    setUnsaved(next);
    setSearchParams(withBoardQuery(searchParams, next), {
      preventScrollReset: true,
      replace: true,
    });
  }

  return { preferences, searchText, update };
}
