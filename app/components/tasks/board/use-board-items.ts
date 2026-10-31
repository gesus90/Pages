import { useEffect, useState } from "react";
import { useActionData } from "react-router";
import { BOARD_TICKET_UPDATE_INTENTS } from "@/app/lib/task-overlay-navigation";

import type { action } from "@/app/routes/tasks";
import type { ArchivedFilter } from "@/app/lib/tasks-view";
import type { WorkItemDetail } from "@/definition/Task";
import type { useTaskSelection } from "./use-task-selection";

const ADDED_TICKET_INTENTS: ReadonlySet<string> = new Set([
  "create-task",
  "move-project",
  "restore-task",
]);

function matchesArchive(item: WorkItemDetail, filter: ArchivedFilter): boolean {
  if (filter === "all") return true;
  if (filter === "active") return item.archivedAt === null;
  return item.archivedAt !== null;
}

/** Replaces only tickets returned by successful inline edits. */
export function useBoardItems(
  items: readonly WorkItemDetail[],
  details: ReturnType<typeof useTaskSelection>,
  archivedFilter: ArchivedFilter,
): readonly WorkItemDetail[] {
  const actionData = useActionData<typeof action>();
  const [replacements, setReplacements] = useState<
    Readonly<Record<string, WorkItemDetail>>
  >({});
  const [addedIds, setAddedIds] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    setReplacements({});
    setAddedIds(new Set());
  }, [items]);

  useEffect(() => {
    if (
      actionData?.ok &&
      BOARD_TICKET_UPDATE_INTENTS.has(actionData.intent) &&
      actionData.ticket
    ) {
      const ticket = actionData.ticket;
      setReplacements((previous) => {
        const next = { ...previous, [ticket.id]: ticket };
        for (const related of actionData.related ?? [])
          next[related.id] = related;
        return next;
      });
      if (ADDED_TICKET_INTENTS.has(actionData.intent)) {
        const affected = [ticket, ...(actionData.related ?? [])];
        setAddedIds((previous) => {
          const next = new Set(previous);
          for (const item of affected) {
            if (item.archivedAt === null) next.add(item.id);
          }
          return next;
        });
      }
    }
  }, [actionData]);

  useEffect(() => {
    const selected = details.selection?.selectedItem;
    if (!details.isFresh || !selected) return;
    setReplacements((previous) => {
      const next = { ...previous, [selected.id]: selected };
      for (const related of details.related) next[related.id] = related;
      return next;
    });
  }, [details.isFresh, details.related, details.selection]);

  const knownIds = new Set(items.map((item) => item.id));
  return [
    ...items.map((item) => replacements[item.id] ?? item),
    ...Object.values(replacements).filter(
      (item) => addedIds.has(item.id) && !knownIds.has(item.id),
    ),
  ].filter((item) => matchesArchive(item, archivedFilter));
}
