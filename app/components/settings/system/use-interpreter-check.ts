import { useCallback, useEffect, useRef } from "react";

import { interpreterProfileSchema } from "@/definition/InterpreterProfile";

import { requestInterpreterCheck } from "./interpreter-requests";

import type { Dispatch, SetStateAction } from "react";
import type { InterpreterRow } from "./interpreter-editor-state";

/** Rejects late responses using both a request generation and the current path. */
export function useInterpreterCheck(
  rows: readonly InterpreterRow[],
  setRows: Dispatch<SetStateAction<InterpreterRow[]>>,
): {
  readonly checkProfile: (id: string) => Promise<void>;
  readonly invalidate: (id: string) => void;
} {
  const currentRows = useRef(rows);
  const requests = useRef(new Map<string, number>());
  currentRows.current = rows;
  const checkProfile = useCallback(
    async (id: string): Promise<void> => {
      const row = currentRows.current.find(
        (candidate) => candidate.profile.id === id,
      );
      if (!row || !interpreterProfileSchema.safeParse(row.profile).success)
        return;
      const generation = (requests.current.get(id) ?? 0) + 1;
      requests.current.set(id, generation);
      setRows((current) =>
        current.map((candidate) =>
          candidate.profile.id === id
            ? { ...candidate, isChecking: true, check: undefined }
            : candidate,
        ),
      );
      const result = await requestInterpreterCheck(row.profile);
      if (requests.current.get(id) !== generation) return;
      setRows((current) =>
        current.map((candidate) =>
          candidate.profile.id === id && candidate.profile.path === result.path
            ? { ...candidate, check: result, isChecking: false }
            : candidate,
        ),
      );
    },
    [setRows],
  );
  function invalidate(id: string): void {
    requests.current.set(id, (requests.current.get(id) ?? 0) + 1);
  }
  return { checkProfile, invalidate };
}

/** Debounces edits of saved paths; new rows require explicit Sync. */
export function useAutomaticInterpreterCheck(
  row: InterpreterRow,
  savedPath: string | undefined,
  check: (id: string) => Promise<void>,
): void {
  const { id, name, path } = row.profile;
  const initialPath = useRef(path);
  const previousSavedPath = useRef(savedPath);
  const hasEditedPath = useRef(false);
  useEffect(() => {
    if (savedPath !== previousSavedPath.current) {
      previousSavedPath.current = savedPath;
      initialPath.current = path;
      hasEditedPath.current = false;
      return;
    }
    if (path !== initialPath.current) hasEditedPath.current = true;
    if (
      savedPath === undefined ||
      !hasEditedPath.current ||
      !interpreterProfileSchema.safeParse({ id, name, path }).success
    )
      return;
    const timer = setTimeout(() => {
      void check(id);
    }, 350);
    return () => clearTimeout(timer);
  }, [id, name, path, savedPath, check]);
}
