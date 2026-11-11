import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useSidebarLayout } from "@/app/components/common/app-shell/use-sidebar-layout";

const STORAGE_KEY = "pages.navigation.sidebar";

function store(value: unknown): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

function readStored(): unknown {
  return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

it("starts with the designed layout when nothing is stored", () => {
  const { result } = renderHook(() => useSidebarLayout());

  expect(result.current.isCollapsed).toBe(false);
  expect(result.current.isResizing).toBe(false);
  expect(result.current.preferredWidth).toBeNull();
  expect(result.current.shellStyle).toBeUndefined();
  expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
});

it("applies the stored layout after mounting", () => {
  store({ isCollapsed: true, width: 320 });

  const { result } = renderHook(() => useSidebarLayout());

  expect(result.current.isCollapsed).toBe(true);
  expect(result.current.preferredWidth).toBe(320);
  expect(result.current.shellStyle).toEqual({
    "--app-sidebar-preferred": "320px",
  });
});

it("treats a missing or null stored width as the designed width", () => {
  store({ isCollapsed: true });

  const { result } = renderHook(() => useSidebarLayout());

  expect(result.current.isCollapsed).toBe(true);
  expect(result.current.preferredWidth).toBeNull();
  expect(result.current.shellStyle).toBeUndefined();
});

it.each([
  ["a JSON null", "null"],
  ["a JSON number", "42"],
  ["a missing collapsed flag", JSON.stringify({ width: 300 })],
  ["a non-boolean collapsed flag", JSON.stringify({ isCollapsed: "yes" })],
  ["a zero width", JSON.stringify({ isCollapsed: false, width: 0 })],
  ["a negative width", JSON.stringify({ isCollapsed: false, width: -5 })],
  [
    "a width no screen shows",
    JSON.stringify({ isCollapsed: true, width: 10_001 }),
  ],
  ["a text width", JSON.stringify({ isCollapsed: true, width: "300" })],
])("ignores a stored layout with %s", (label, raw) => {
  window.localStorage.setItem(STORAGE_KEY, raw);

  const { result } = renderHook(() => useSidebarLayout());

  expect(result.current.isCollapsed).toBe(false);
  expect(result.current.preferredWidth).toBeNull();
});

it("accepts the largest storable width", () => {
  store({ isCollapsed: false, width: 10_000 });

  const { result } = renderHook(() => useSidebarLayout());

  expect(result.current.preferredWidth).toBe(10_000);
});

it("falls back to the designed layout and warns about unparsable storage", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  window.localStorage.setItem(STORAGE_KEY, "{not json");

  const { result } = renderHook(() => useSidebarLayout());

  expect(result.current.isCollapsed).toBe(false);
  expect(result.current.preferredWidth).toBeNull();
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0]?.[0]).toBe(
    "Pages could not read the stored navigation layout.",
  );
});

it("falls back to the designed layout when storage cannot be read", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("storage blocked");
  });

  const { result } = renderHook(() => useSidebarLayout());

  expect(result.current.isCollapsed).toBe(false);
  expect(warn).toHaveBeenCalledTimes(1);
});

it("toggles collapsing, stores it and keeps the open width", () => {
  store({ isCollapsed: false, width: 280 });
  const { result } = renderHook(() => useSidebarLayout());

  act(() => result.current.toggleCollapsed());

  expect(result.current.isCollapsed).toBe(true);
  expect(result.current.preferredWidth).toBe(280);
  expect(readStored()).toEqual({ isCollapsed: true, width: 280 });

  act(() => result.current.toggleCollapsed());

  expect(result.current.isCollapsed).toBe(false);
  expect(readStored()).toEqual({ isCollapsed: false, width: 280 });
});

it("marks a resize as running until the width is committed and stores it", () => {
  const { result } = renderHook(() => useSidebarLayout());

  act(() => result.current.startResize());

  expect(result.current.isResizing).toBe(true);
  expect(readStored()).toBeNull();

  act(() => result.current.commitWidth(360));

  expect(result.current.isResizing).toBe(false);
  expect(result.current.preferredWidth).toBe(360);
  expect(result.current.shellStyle).toEqual({
    "--app-sidebar-preferred": "360px",
  });
  expect(readStored()).toEqual({ isCollapsed: false, width: 360 });
});

it("keeps the collapsed state when a width is committed", () => {
  store({ isCollapsed: true, width: null });
  const { result } = renderHook(() => useSidebarLayout());

  act(() => result.current.commitWidth(300));

  expect(result.current.isCollapsed).toBe(true);
  expect(readStored()).toEqual({ isCollapsed: true, width: 300 });
});

it("keeps the new layout in memory and warns when storage rejects the write", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota exceeded");
  });
  const { result } = renderHook(() => useSidebarLayout());

  act(() => result.current.toggleCollapsed());

  expect(result.current.isCollapsed).toBe(true);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0]?.[0]).toBe(
    "Pages could not store the navigation layout.",
  );
});
