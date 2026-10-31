import { useRef } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";

function isBoardOverlay(state: unknown): boolean {
  return (
    typeof state === "object" &&
    state !== null &&
    "boardOverlay" in state &&
    state.boardOverlay === true
  );
}

/** Opens the URL-selected detail and restores the card after it closes. */
export function useTaskDetailNavigation(onSelect: (key: string) => void): {
  readonly openTask: (key: string) => void;
  readonly closeDetail: () => void;
  readonly restoreFocus: () => void;
} {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const opener = useRef<HTMLElement | null>(null);

  function openTask(key: string): void {
    const params = new URLSearchParams(searchParams);
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      active.closest('[role="dialog"]') === null
    ) {
      opener.current = active;
    }
    onSelect(key);
    const isOpen = params.has("item");
    params.set("item", key);
    void navigate(`?${params.toString()}`, {
      preventScrollReset: true,
      replace: isOpen,
      state: { boardOverlay: isOpen ? isBoardOverlay(location.state) : true },
    });
  }

  function closeDetail(): void {
    if (isBoardOverlay(location.state)) {
      void navigate(-1);
      return;
    }
    const params = new URLSearchParams(searchParams);
    params.delete("item");
    void navigate(`?${params.toString()}`, {
      preventScrollReset: true,
      replace: true,
    });
  }

  return { openTask, closeDetail, restoreFocus: () => opener.current?.focus() };
}
