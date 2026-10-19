import { useState } from "react";

import {
  canSaveInterpreterRows,
  interpreterRows,
  isChangedInterpreterRow,
} from "./interpreter-editor-state";
import { requestInterpreterSave } from "./interpreter-requests";
import { useInterpreterCheck } from "./use-interpreter-check";

import type { InterpreterSnapshot } from "@/definition/InterpreterProfile";
import type { InterpreterRow } from "./interpreter-editor-state";

interface InterpreterEditor {
  readonly rows: readonly InterpreterRow[];
  readonly saved: InterpreterSnapshot;
  readonly isSaving: boolean;
  readonly message: string;
  readonly canSave: boolean;
  readonly add: () => void;
  readonly update: (id: string, field: "name" | "path", text: string) => void;
  readonly checkProfile: (id: string) => Promise<void>;
  readonly save: () => Promise<void>;
}

/** Keeps typing, observing and saving as separate operations. */
export function useInterpreterProfiles(
  snapshot: InterpreterSnapshot,
): InterpreterEditor {
  const [saved, setSaved] = useState(snapshot);
  const [rows, setRows] = useState(() => interpreterRows(snapshot));
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const { checkProfile, invalidate } = useInterpreterCheck(rows, setRows);

  function update(id: string, field: "name" | "path", text: string): void {
    invalidate(id);
    setMessage("");
    setRows((current) =>
      current.map((row) =>
        row.profile.id === id
          ? {
              ...row,
              profile: { ...row.profile, [field]: text },
              isChecking: false,
              check: field === "path" ? undefined : row.check,
            }
          : row,
      ),
    );
  }

  function add(): void {
    setMessage("");
    setRows((current) => [
      ...current,
      {
        profile: { id: crypto.randomUUID(), name: "", path: "" },
        isChecking: false,
      },
    ]);
  }

  async function save(): Promise<void> {
    if (!canSaveInterpreterRows(rows, saved) || isSaving) return;
    setIsSaving(true);
    setMessage("");
    setRows(
      rows.map((row) =>
        isChangedInterpreterRow(row, saved)
          ? { ...row, isChecking: true, check: undefined }
          : row,
      ),
    );
    try {
      const result = await requestInterpreterSave(
        rows.map((row) => row.profile),
        saved.revision,
      );
      if ("error" in result) {
        setRows(
          rows.map((row) => ({
            ...row,
            check: result.checks[row.profile.id] ?? row.check,
            isChecking: false,
          })),
        );
        setMessage(result.error);
        return;
      }
      setSaved(result);
      setRows(interpreterRows(result));
      setMessage("saved");
    } catch {
      setRows(rows);
      setMessage("general");
    } finally {
      setIsSaving(false);
    }
  }

  return {
    rows,
    saved,
    isSaving,
    message,
    canSave: !isSaving && canSaveInterpreterRows(rows, saved),
    add,
    update,
    checkProfile,
    save,
  };
}
