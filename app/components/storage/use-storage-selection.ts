import { useState } from "react";

import type { StorageItem } from "@/definition/GoogleDriveStorage";

/** The selected entries of the shown folder (PAGE-272). */
export interface StorageSelection {
  /** The selected entries in list order; entries gone after a reload drop out. */
  readonly items: readonly StorageItem[];
  readonly isMultiSelect: boolean;
  readonly isSelected: (ref: string) => boolean;
  /** A click on a row: selects only it, or adds or removes it with Ctrl/Cmd or in the multi-select mode. */
  readonly click: (ref: string, isAdditive: boolean) => void;
  /** A right click: keeps a selection that holds the row, else selects only it. */
  readonly prepareContextMenu: (ref: string) => void;
  readonly toggle: (ref: string) => void;
  readonly selectAll: () => void;
  readonly clear: () => void;
  readonly toggleMultiSelect: () => void;
}

interface SelectionState {
  /** The folder the selection belongs to. */
  readonly folderKey: string | null;
  readonly refs: ReadonlySet<string>;
}

const NOTHING: ReadonlySet<string> = new Set();

/**
 * Holds which entries of the shown folder are selected.
 *
 * @param items - The loaded entries of the shown folder.
 * @param folderKey - The shown folder; another one starts with an empty selection.
 * @returns The selection and its changes.
 *
 * @remarks
 * The selection remembers its folder instead of being cleared by an effect,
 * so it is empty in the very render that shows another folder.
 */
export function useStorageSelection(
  items: readonly StorageItem[],
  folderKey: string | null,
): StorageSelection {
  const [state, setState] = useState<SelectionState>({
    folderKey,
    refs: NOTHING,
  });
  const [isMultiSelect, setIsMultiSelect] = useState(false);
  const refs = state.folderKey === folderKey ? state.refs : NOTHING;

  function replace(next: ReadonlySet<string>): void {
    setState({ folderKey, refs: next });
  }

  function toggle(ref: string): void {
    const next = new Set(refs);

    if (next.has(ref)) next.delete(ref);
    else next.add(ref);

    replace(next);
  }

  return {
    clear: () => replace(NOTHING),
    click: (ref, isAdditive) => {
      if (isAdditive || isMultiSelect) toggle(ref);
      else replace(new Set([ref]));
    },
    isMultiSelect,
    isSelected: (ref) => refs.has(ref),
    items: items.filter((item) => refs.has(item.id)),
    prepareContextMenu: (ref) => {
      if (!refs.has(ref)) replace(new Set([ref]));
    },
    selectAll: () => replace(new Set(items.map((item) => item.id))),
    toggle,
    toggleMultiSelect: () => setIsMultiSelect(!isMultiSelect),
  };
}
