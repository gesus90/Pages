import { useState } from "react";

import { OPEN_MEDIA_FILTER } from "@/definition/ConversationMediaOverview";

import type {
  ConversationMediaFilter,
  ConversationMediaTab,
} from "@/definition/ConversationMediaOverview";

/** What the person chose in "Medien & Dateien". */
export interface MediaOverviewState {
  readonly tab: ConversationMediaTab;
  selectTab(tab: ConversationMediaTab): void;
  readonly filter: ConversationMediaFilter;
  changeFilter(change: Partial<ConversationMediaFilter>): void;
  /** The marked files, for one ZIP archive. */
  readonly selected: ReadonlySet<string>;
  toggleSelected(attachmentId: string): void;
  /** Marks the given files; marks none when all of them are marked already. */
  toggleAll(attachmentIds: readonly string[]): void;
  clearSelected(): void;
  /** The document, sound or file shown large in the panel; `null` shows the list. */
  readonly detailId: string | null;
  openDetail(attachmentId: string | null): void;
}

/**
 * The tab, the search and filters, the marked files and the file shown large
 * of "Medien & Dateien".
 * @remarks
 * Changing the tab closes the file shown large; the marks stay across tabs,
 * so one archive can hold images and documents.
 */
export function useMediaOverviewState(): MediaOverviewState {
  const [tab, setTab] = useState<ConversationMediaTab>("images");
  const [filter, setFilter] =
    useState<ConversationMediaFilter>(OPEN_MEDIA_FILTER);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);

  function toggleSelected(attachmentId: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(attachmentId)) next.delete(attachmentId);
      else next.add(attachmentId);
      return next;
    });
  }

  function toggleAll(attachmentIds: readonly string[]): void {
    setSelected((current) => {
      const isAll = attachmentIds.every((id) => current.has(id));
      const next = new Set(current);
      for (const id of attachmentIds) {
        if (isAll) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  return {
    tab,
    selectTab: (next) => {
      setTab(next);
      setDetailId(null);
    },
    filter,
    changeFilter: (change) =>
      setFilter((current) => ({ ...current, ...change })),
    selected,
    toggleSelected,
    toggleAll,
    clearSelected: () => setSelected(new Set()),
    detailId,
    openDetail: setDetailId,
  };
}
