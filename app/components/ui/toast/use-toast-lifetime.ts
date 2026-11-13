import { useEffect, useRef, useState } from "react";

import { TOAST_DURATIONS, TOAST_EXIT_MILLISECONDS } from "./toast-types";

import type { ToastMessage } from "./toast-types";

/** Tracks the remaining visible time independently of other cards and overlapping interactions. */
export function useToastLifetime(
  toast: ToastMessage,
  onDismiss: () => void,
): {
  readonly isLeaving: boolean;
  readonly dismiss: () => void;
  readonly setHovered: (isHovered: boolean) => void;
  readonly setFocused: (isFocused: boolean) => void;
} {
  const [isHovered, setHovered] = useState(false);
  const [isFocused, setFocused] = useState(false);
  const [leavingRevision, setLeavingRevision] = useState<number | null>(null);
  const lifetime = useRef({ revision: -1, remaining: 0 });
  const isLeaving = leavingRevision === toast.revision;
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);
  const duration = TOAST_DURATIONS[toast.type];
  useEffect(() => {
    const remaining = lifetime.current;
    if (remaining.revision !== toast.revision) {
      remaining.revision = toast.revision;
      remaining.remaining = duration ?? 0;
    }
    if (duration === null || isHovered || isFocused || isLeaving) return;
    const started = Date.now();
    const timer = window.setTimeout(
      () => setLeavingRevision(toast.revision),
      remaining.remaining,
    );
    return () => {
      window.clearTimeout(timer);
      remaining.remaining = Math.max(
        0,
        remaining.remaining - (Date.now() - started),
      );
    };
  }, [duration, isHovered, isFocused, isLeaving, toast.revision]);
  useEffect(() => {
    if (!isLeaving) return;
    const timer = window.setTimeout(
      () => dismissRef.current(),
      TOAST_EXIT_MILLISECONDS,
    );
    return () => window.clearTimeout(timer);
  }, [isLeaving]);
  return {
    isLeaving,
    dismiss: () => setLeavingRevision(toast.revision),
    setHovered,
    setFocused,
  };
}
