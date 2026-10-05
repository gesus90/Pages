import { useEffect, useState } from "react";

import { normalizeHexColorCode } from "@/definition/Task";

/** The text of the HEX field and what it means for the picked color. */
export interface HexDraft {
  readonly hexDraft: string;
  readonly isHexValid: boolean;
  readonly changeHexDraft: (value: string) => void;
}

/**
 * Keeps the text typed into the HEX field next to the picked color.
 *
 * @remarks
 * A stale draft follows external changes (presets, pad, slider), but an
 * invalid draft is the user mid-typing and must never be overwritten.
 *
 * @param color - The picked color the draft follows.
 * @param onChange - Receives the normalized color once the draft is valid.
 */
export function useHexDraft(
  color: string,
  onChange: (color: string) => void,
): HexDraft {
  const [hexDraft, setHexDraft] = useState(color.toUpperCase());

  useEffect(() => {
    const draftNormalized = normalizeHexColorCode(hexDraft.trim());

    if (
      draftNormalized !== null &&
      draftNormalized !== normalizeHexColorCode(color)
    ) {
      setHexDraft(color.toUpperCase());
    }
  }, [color, hexDraft]);

  function changeHexDraft(value: string): void {
    setHexDraft(value);

    const normalized = normalizeHexColorCode(value.trim());

    if (normalized) {
      onChange(normalized);
    }
  }

  return {
    changeHexDraft,
    hexDraft,
    isHexValid: normalizeHexColorCode(hexDraft.trim()) !== null,
  };
}
