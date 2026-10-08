import { useState } from "react";

/** What a key does while a menu is open. */
type MenuKeyAction = "next" | "previous" | "pick" | "close";

const MENU_KEYS: Readonly<Record<string, MenuKeyAction>> = {
  ArrowDown: "next",
  ArrowUp: "previous",
  Enter: "pick",
  Escape: "close",
  Tab: "pick",
};

/** Keyboard control of a menu under the caret. */
export interface MenuNavigation {
  readonly activeIndex: number;
  /** Puts the highlight back on the first entry. */
  readonly reset: () => void;
  /**
   * Handles a key press.
   *
   * @returns Whether the menu used the key, in which case the browser must
   * not act on it.
   */
  readonly handleKey: (key: string) => boolean;
}

/**
 * Moves a highlight through the entries of a menu with the keyboard.
 *
 * @param keys - Keys of the entries, in order; `null` while no menu is open.
 * @param onPick - Called with the key of the highlighted entry.
 * @param onClose - Called when the menu is dismissed.
 * @returns The highlighted position and the key handler.
 */
export function useMenuNavigation(
  keys: readonly string[] | null,
  onPick: (key: string) => void,
  onClose: () => void,
): MenuNavigation {
  const [activeIndex, setActiveIndex] = useState(0);

  return {
    activeIndex,
    handleKey: (key) => {
      const action = keys ? MENU_KEYS[key] : undefined;
      const picked = keys?.[activeIndex];

      if (!keys || action === undefined || (action === "pick" && !picked)) {
        return false;
      }

      if (action === "next") {
        setActiveIndex(Math.min(activeIndex + 1, Math.max(keys.length - 1, 0)));
      } else if (action === "previous") {
        setActiveIndex(Math.max(activeIndex - 1, 0));
      } else if (action === "pick" && picked) {
        onPick(picked);
      } else {
        onClose();
      }

      return true;
    },
    reset: () => setActiveIndex(0),
  };
}
