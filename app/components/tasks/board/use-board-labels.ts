import { useEffect, useState } from "react";

import type { useTaskSelection } from "./use-task-selection";
import type { Label } from "@/definition/Task";

/** Keeps an updated ticket's labels after the overlay closes. */
export function useBoardLabels(
  labelsByWorkItem: Readonly<Record<string, readonly Label[]>>,
  details: ReturnType<typeof useTaskSelection>,
): Readonly<Record<string, readonly Label[]>> {
  const [replacements, setReplacements] = useState<
    Readonly<Record<string, readonly Label[]>>
  >({});
  useEffect(() => {
    setReplacements({});
  }, [labelsByWorkItem]);
  useEffect(() => {
    const selected = details.selection?.selectedItem;
    if (!details.isFresh || !selected) return;
    setReplacements((previous) => ({
      ...previous,
      [selected.id]: details.labels,
    }));
  }, [details.isFresh, details.labels, details.selection]);
  return { ...labelsByWorkItem, ...replacements };
}
