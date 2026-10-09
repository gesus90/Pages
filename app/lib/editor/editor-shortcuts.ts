/** A key of a shortcut; `Mod` is Cmd on Apple devices and Ctrl elsewhere. */
type ShortcutKey =
  "Mod" | "Shift" | "Alt" | "ArrowUp" | "ArrowDown" | "F10" | string;

/**
 * The keyboard shortcuts of the block editor. Menus show them next to their
 * entries; the editor binds the same keys, so both run the same action.
 *
 * @remarks
 * `Mod+J` opens the AI part of the context menu (as in Notion). `Mod+Shift+
 * ArrowUp/ArrowDown` moves a block (as in Notion); inside the editor it
 * replaces the native "select to start/end of the document". `Mod+Enter`
 * saves a ticket description (as in Jira); the wiki saves by itself.
 */
export const EDITOR_SHORTCUTS = {
  assistantChat: ["Mod", "Alt", "Shift", "J"],
  bold: ["Mod", "B"],
  bulletList: ["Mod", "Shift", "8"],
  code: ["Mod", "E"],
  codeBlock: ["Mod", "Alt", "C"],
  contextMenu: ["Shift", "F10"],
  copy: ["Mod", "C"],
  cut: ["Mod", "X"],
  duplicate: ["Mod", "D"],
  heading1: ["Mod", "Alt", "1"],
  heading2: ["Mod", "Alt", "2"],
  heading3: ["Mod", "Alt", "3"],
  italic: ["Mod", "I"],
  link: ["Mod", "K"],
  moveDown: ["Mod", "Shift", "ArrowDown"],
  moveUp: ["Mod", "Shift", "ArrowUp"],
  orderedList: ["Mod", "Shift", "7"],
  paragraph: ["Mod", "Alt", "0"],
  paste: ["Mod", "V"],
  pastePlain: ["Mod", "Shift", "V"],
  quote: ["Mod", "Shift", "B"],
  redo: ["Mod", "Shift", "Z"],
  saveDescription: ["Mod", "Enter"],
  selectAll: ["Mod", "A"],
  strike: ["Mod", "Shift", "S"],
  taskList: ["Mod", "Shift", "9"],
  textAssistant: ["Mod", "J"],
  undo: ["Mod", "Z"],
} as const satisfies Readonly<Record<string, readonly ShortcutKey[]>>;

/** The name of a shortcut of the editor. */
export type EditorShortcut = keyof typeof EDITOR_SHORTCUTS;

const MAC_SYMBOLS: Readonly<Record<string, string>> = {
  Alt: "⌥",
  ArrowDown: "↓",
  ArrowUp: "↑",
  Mod: "⌘",
  Shift: "⇧",
};

const OTHER_NAMES: Readonly<Record<string, string>> = {
  ArrowDown: "↓",
  ArrowUp: "↑",
  Mod: "Ctrl",
};

/**
 * Tells whether the device uses the Apple modifier keys.
 *
 * @param platform - `navigator.platform` or a user agent string.
 * @returns Whether `Mod` means the Command key.
 */
export function isApplePlatform(platform: string): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}

/**
 * Writes a shortcut the way the platform shows it.
 *
 * @param shortcut - Name of the shortcut.
 * @param isApple - Whether the device uses Apple modifier keys.
 * @returns For example `⌘⇧Z` on Apple devices and `Ctrl+Shift+Z` elsewhere.
 */
export function formatShortcut(
  shortcut: EditorShortcut,
  isApple: boolean,
): string {
  const keys: readonly string[] = EDITOR_SHORTCUTS[shortcut];

  return isApple
    ? keys.map((key) => MAC_SYMBOLS[key] ?? key).join("")
    : keys.map((key) => OTHER_NAMES[key] ?? key).join("+");
}
