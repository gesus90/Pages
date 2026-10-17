import { useEffect, useState } from "react";

import type { CSSProperties } from "react";

/** Browser storage entry that keeps the sidebar layout across reloads. */
const STORAGE_KEY = "pages.navigation.sidebar";

/** Stored widths above this are not a width a screen can show. */
const MAXIMUM_STORED_WIDTH = 10_000;

interface StoredSidebarLayout {
  readonly isCollapsed: boolean;
  /** Last chosen open width in CSS pixels; `null` keeps the designed width. */
  readonly width: number | null;
}

/** Inline style of the shell that carries the chosen open width. */
export interface SidebarShellStyle extends CSSProperties {
  readonly "--app-sidebar-preferred": string;
}

/** Layout state of the permanent sidebar and the actions that change it. */
export interface SidebarLayout {
  readonly isCollapsed: boolean;
  /** Whether the sidebar edge is being dragged right now. */
  readonly isResizing: boolean;
  /** Last chosen open width in CSS pixels; `null` keeps the designed width. */
  readonly preferredWidth: number | null;
  readonly shellStyle: SidebarShellStyle | undefined;
  readonly toggleCollapsed: () => void;
  readonly startResize: () => void;
  /** Ends a resize and keeps the given open width. */
  readonly commitWidth: (width: number) => void;
}

const DEFAULT_LAYOUT: StoredSidebarLayout = { isCollapsed: false, width: null };

function isStoredWidth(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === "number" &&
      Number.isFinite(value) &&
      value > 0 &&
      value <= MAXIMUM_STORED_WIDTH)
  );
}

function parseStoredLayout(raw: string): StoredSidebarLayout | null {
  const parsed: unknown = JSON.parse(raw);

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const isCollapsed = "isCollapsed" in parsed ? parsed.isCollapsed : null;
  const width = "width" in parsed ? parsed.width : null;

  if (typeof isCollapsed !== "boolean" || !isStoredWidth(width)) {
    return null;
  }

  return { isCollapsed, width };
}

function readStoredLayout(): StoredSidebarLayout | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    return raw === null ? null : parseStoredLayout(raw);
  } catch (error: unknown) {
    console.warn("Pages could not read the stored navigation layout.", error);
    return null;
  }
}

function writeStoredLayout(layout: StoredSidebarLayout): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch (error: unknown) {
    console.warn("Pages could not store the navigation layout.", error);
  }
}

/**
 * Keeps whether the permanent sidebar is collapsed and how wide it is open.
 *
 * @remarks
 * The state lives in the authenticated layout, so it survives every route
 * change; the browser storage only restores it after a reload. The server and
 * the first client render use the designed layout, and the stored layout
 * applies after hydration. Collapsing keeps the open width, so expanding
 * returns to it; the stylesheet fits it into the current viewport.
 */
export function useSidebarLayout(): SidebarLayout {
  const [layout, setLayout] = useState<StoredSidebarLayout>(DEFAULT_LAYOUT);
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    const stored = readStoredLayout();

    if (stored) {
      setLayout(stored);
    }
  }, []);

  function update(next: StoredSidebarLayout): void {
    setLayout(next);
    writeStoredLayout(next);
  }

  function toggleCollapsed(): void {
    update({ ...layout, isCollapsed: !layout.isCollapsed });
  }

  function startResize(): void {
    setIsResizing(true);
  }

  function commitWidth(width: number): void {
    setIsResizing(false);
    update({ ...layout, width });
  }

  return {
    isCollapsed: layout.isCollapsed,
    isResizing,
    preferredWidth: layout.width,
    shellStyle:
      layout.width === null
        ? undefined
        : { "--app-sidebar-preferred": `${layout.width}px` },
    toggleCollapsed,
    startResize,
    commitWidth,
  };
}
