import { expect, it } from "vitest";

import {
  EDITOR_SHORTCUTS,
  formatShortcut,
  isApplePlatform,
} from "@/app/lib/editor/editor-shortcuts";

it("recognises Apple platforms by their platform or user agent", () => {
  expect(isApplePlatform("MacIntel")).toBe(true);
  expect(isApplePlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)")).toBe(
    true,
  );
  expect(isApplePlatform("ipad")).toBe(true);
  expect(isApplePlatform("Win32")).toBe(false);
  expect(isApplePlatform("Linux x86_64")).toBe(false);
});

it("writes a shortcut with Apple symbols on Apple devices", () => {
  expect(formatShortcut("redo", true)).toBe("⌘⇧Z");
  expect(formatShortcut("codeBlock", true)).toBe("⌘⌥C");
  expect(formatShortcut("moveUp", true)).toBe("⌘⇧↑");
  expect(formatShortcut("contextMenu", true)).toBe("⇧F10");
});

it("writes a shortcut with key names elsewhere", () => {
  expect(formatShortcut("redo", false)).toBe("Ctrl+Shift+Z");
  expect(formatShortcut("codeBlock", false)).toBe("Ctrl+Alt+C");
  expect(formatShortcut("moveDown", false)).toBe("Ctrl+Shift+↓");
  expect(formatShortcut("saveDescription", false)).toBe("Ctrl+Enter");
});

it("binds the same keys the menus show", () => {
  expect(EDITOR_SHORTCUTS.bold).toEqual(["Mod", "B"]);
  expect(EDITOR_SHORTCUTS.pastePlain).toEqual(["Mod", "Shift", "V"]);
});
