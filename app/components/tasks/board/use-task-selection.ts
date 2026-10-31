import { useEffect } from "react";
import { useFetcher, useSearchParams } from "react-router";

import type { loader as panelLoader } from "@/app/routes/task-panel-data";
import type { loader as boardLoader } from "@/app/routes/tasks";
import type { WorkItemDetail } from "@/definition/Task";

const NO_RELATED: readonly WorkItemDetail[] = [];

/** Loads an addressed ticket without reloading the board. */
export function useTaskSelection(
  initial: Awaited<ReturnType<typeof boardLoader>>,
): {
  readonly selectedKey: string | null;
  readonly selection:
    Awaited<ReturnType<typeof panelLoader>>["selection"] | null;
  readonly labels: Awaited<ReturnType<typeof panelLoader>>["labels"];
  readonly isUnavailable: boolean;
  readonly related: readonly WorkItemDetail[];
  readonly isFresh: boolean;
  readonly labelUsage: Readonly<Record<string, number>> | null;
  readonly reload: () => void;
} {
  const [params] = useSearchParams();
  const selectedKey = params.get("item");
  const { load, data: result, state } = useFetcher<typeof panelLoader>();

  function reload(): void {
    if (selectedKey)
      void load(`/aufgaben-api/panel/${encodeURIComponent(selectedKey)}`);
  }

  useEffect(() => {
    if (selectedKey) {
      void load(`/aufgaben-api/panel/${encodeURIComponent(selectedKey)}`);
    }
  }, [load, selectedKey]);

  if (selectedKey && result?.key === selectedKey) {
    return {
      selectedKey,
      selection: result.selection,
      labels: result.labels,
      isUnavailable: !result.selection?.selectedItem,
      related: result.related,
      isFresh: state === "idle",
      labelUsage: result.labelUsage,
      reload,
    };
  }

  const initialItem = initial.selectedItem;
  if (
    selectedKey &&
    initialItem &&
    (initialItem.key === selectedKey || initialItem.id === selectedKey)
  ) {
    return {
      selectedKey,
      selection: initial,
      labels: initial.labelsByWorkItem[initialItem.id] ?? [],
      isUnavailable: false,
      related: NO_RELATED,
      isFresh: false,
      labelUsage: null,
      reload,
    };
  }

  return {
    selectedKey,
    selection: null,
    labels: [],
    isUnavailable: false,
    related: NO_RELATED,
    isFresh: false,
    labelUsage: null,
    reload,
  };
}
