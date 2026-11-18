import { useEffect, useRef } from "react";

/** Refreshes usage and session facts, such as the context occupancy, after activity, at most once per 1.5 seconds. */
export function useSessionRefresh(
  isEnabled: boolean,
  refresh: () => void,
): () => void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  });
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  return () => {
    if (!isEnabled || timer.current !== null) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      latest.current();
    }, 1500);
  };
}
