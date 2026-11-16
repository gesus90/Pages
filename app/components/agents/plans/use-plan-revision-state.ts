import { useEffect, useState } from "react";

/** Keeps dialog edits at their original revision while following pristine server fields. */
export function usePlanRevisionState<T>(
  initial: T,
  revision: number,
): {
  readonly current: T;
  readonly setCurrent: (next: T) => void;
  readonly revision: number;
  readonly isOutdated: boolean;
} {
  const [state, setState] = useState({ initial, revision, current: initial });
  const isDirty =
    JSON.stringify(state.current) !== JSON.stringify(state.initial);
  useEffect(() => {
    if (isDirty || state.revision >= revision) return;
    setState((previous) =>
      JSON.stringify(previous.current) === JSON.stringify(previous.initial)
        ? { initial, revision, current: initial }
        : previous,
    );
  }, [initial, revision, isDirty, state.revision]);
  return {
    current: state.current,
    setCurrent: (current) => setState((previous) => ({ ...previous, current })),
    revision: state.revision,
    isOutdated: state.revision < revision,
  };
}
