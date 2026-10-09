import { useState } from "react";
import { useFetcher, useParams } from "react-router";

import { buildTicketTree, findTreePath } from "@/app/lib/ticket-tree";

import type { TicketTreeProject } from "@/app/lib/ticket-tree";
import type { TicketLayoutData } from "@/app/routes/tasks-layout";
import type { TicketTreeEntry } from "@/definition/Task";

/** State and handlers the ticket tree needs. */
export interface TicketTreeState {
  readonly projects: readonly TicketTreeProject<TicketTreeEntry>[];
  /** Id of the ticket the page shows, or `null`. */
  readonly currentId: string | null;
  readonly expandedKeys: ReadonlySet<string>;
  readonly onToggle: (nodeKey: string) => void;
}

/**
 * Keeps which branches of the ticket tree are open (A8.2-E08).
 *
 * @param layout - The tickets and the stored open branches.
 * @returns The tree and its open state.
 *
 * @remarks
 * Opening and closing is stored for the person, as in the wiki. When a ticket
 * page opens, the path to the ticket opens too, without being stored; the
 * person may close it again.
 */
export function useTicketTree(layout: TicketLayoutData): TicketTreeState {
  const { ticketKey = null } = useParams();
  const fetcher = useFetcher();
  const current = layout.entries.find((entry) => entry.key === ticketKey);
  const path = findTreePath(layout.entries, current?.id ?? null);
  const pathKey = path.join("|");
  const [opened, setOpened] = useState<ReadonlySet<string>>(
    () => new Set([...layout.expandedKeys, ...path]),
  );
  const [shownPath, setShownPath] = useState(pathKey);

  // Another ticket opened: show its path as well (state adjusted while
  // rendering, as React recommends instead of an effect).
  if (shownPath !== pathKey) {
    setShownPath(pathKey);
    setOpened((previous) => new Set([...previous, ...path]));
  }

  function handleToggle(nodeKey: string): void {
    const isOpen = !opened.has(nodeKey);
    const next = new Set(opened);

    if (isOpen) {
      next.add(nodeKey);
    } else {
      next.delete(nodeKey);
    }

    setOpened(next);
    void fetcher.submit(
      { expanded: isOpen ? "1" : "0", intent: "set-tree-expanded", nodeKey },
      { action: "/aufgaben", method: "post" },
    );
  }

  return {
    currentId: current?.id ?? null,
    expandedKeys: opened,
    onToggle: handleToggle,
    projects: buildTicketTree(layout.entries),
  };
}
