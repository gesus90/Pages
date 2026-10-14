import { useState } from "react";

import type { PlanLink } from "./plan-links";

/** Either one node or one connection is selected, never both. */
export interface PlanSelection {
  readonly selectedId: string | null;
  readonly selectedLink: PlanLink | null;
  readonly select: (id: string | null) => void;
  readonly selectLink: (link: PlanLink | null) => void;
}

/** Keeps the node and connection selection of the grid mutually exclusive. */
export function usePlanSelection(): PlanSelection {
  const [selection, setSelection] = useState<{
    readonly id: string | null;
    readonly link: PlanLink | null;
  }>({ id: null, link: null });
  function select(id: string | null): void {
    setSelection({ id, link: null });
  }
  function selectLink(link: PlanLink | null): void {
    setSelection({ id: null, link });
  }
  return {
    selectedId: selection.id,
    selectedLink: selection.link,
    select,
    selectLink,
  };
}
