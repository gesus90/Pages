import { useState } from "react";

import { requestStorageChange } from "./storage-actions-requests";

import type {
  StorageConfirmation,
  StorageEntry,
  StorageError,
} from "@/definition/GoogleDriveFiles";

import type { StorageChange } from "./storage-actions-requests";

/** The entry an action works on, from a folder listing or from the trash. */
export interface StorageActionTarget {
  readonly ref: string;
  readonly name: string;
  readonly isFolder: boolean;
}

/** What a name dialog asks the name for. */
export type StorageNamePurpose = "create_folder" | "rename";

/** The dialog the actions show right now. */
export type StorageActionDialog =
  | { readonly kind: "none" }
  | {
      readonly kind: "name";
      readonly purpose: StorageNamePurpose;
      readonly target: StorageActionTarget | null;
    }
  | {
      readonly kind: "conflict";
      readonly change: StorageChange;
      readonly conflicts: readonly StorageEntry[];
      /** Only an upload may replace the existing file. */
      readonly canReplace: boolean;
    }
  | {
      readonly kind: "confirm";
      readonly change: StorageChange;
      readonly confirmation: StorageConfirmation;
      /** Set when the object changed and the server issued a new confirmation. */
      readonly isRefreshed: boolean;
    };

/** The changing actions of the Storage area with their dialogs. */
export interface StorageActionsModel {
  readonly dialog: StorageActionDialog;
  readonly isBusy: boolean;
  /** The last failure that no dialog resolves. */
  readonly error: StorageError | null;
  readonly openNameDialog: (
    purpose: StorageNamePurpose,
    target: StorageActionTarget | null,
  ) => void;
  readonly submitName: (name: string) => void;
  readonly upload: (file: File) => void;
  readonly restore: (target: StorageActionTarget) => void;
  readonly deletePermanently: (target: StorageActionTarget) => void;
  /** Repeats the conflicting call and keeps both entries. */
  readonly keepBoth: () => void;
  /** Repeats a conflicting upload as an overwrite, which asks for a confirmation. */
  readonly replace: () => void;
  /** Repeats the confirmed call with its one-time token. */
  readonly confirm: () => void;
  readonly closeDialog: () => void;
  readonly dismissError: () => void;
}

/** Where the actions work and what happens after a change. */
export interface StorageActionsOptions {
  /** The shown folder, which receives new folders and uploads. */
  readonly parentRef: string | null;
  readonly maxUploadBytes: number | null;
  /** Reloads the shown listing after every successful change. */
  readonly onChanged: () => void;
}

const NO_DIALOG: StorageActionDialog = { kind: "none" };

function withFields(
  change: StorageChange,
  fields: Readonly<Record<string, string>>,
): StorageChange {
  return { ...change, fields: { ...change.fields, ...fields } };
}

/** The dialog that resolves an error, or `null` when only a message helps. */
function dialogForError(
  change: StorageChange,
  error: StorageError,
): StorageActionDialog | null {
  const isConfirmation =
    error.code === "confirmation_required" ||
    error.code === "confirmation_invalid";

  if (isConfirmation && error.confirmation) {
    return {
      change,
      confirmation: error.confirmation,
      isRefreshed: error.code === "confirmation_invalid",
      kind: "confirm",
    };
  }

  if (error.code === "name_conflict" && change.fields.onConflict === "fail") {
    return {
      canReplace: change.operation === "upload",
      change,
      conflicts: error.conflicts ?? [],
      kind: "conflict",
    };
  }

  return null;
}

/** The change a name dialog submits. */
function nameChange(
  dialog: Extract<StorageActionDialog, { kind: "name" }>,
  name: string,
  parentRef: string | null,
): StorageChange | null {
  if (dialog.purpose === "create_folder") {
    return parentRef === null
      ? null
      : {
          fields: { name, onConflict: "fail", parentRef },
          operation: "create_folder",
        };
  }

  return dialog.target === null
    ? null
    : {
        fields: { name, onConflict: "fail", ref: dialog.target.ref },
        operation: "rename",
      };
}

function useChangeRunner(onChanged: () => void): {
  readonly dialog: StorageActionDialog;
  readonly setDialog: (dialog: StorageActionDialog) => void;
  readonly isBusy: boolean;
  readonly error: StorageError | null;
  readonly setError: (error: StorageError | null) => void;
  readonly run: (change: StorageChange) => void;
} {
  const [dialog, setDialog] = useState<StorageActionDialog>(NO_DIALOG);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<StorageError | null>(null);

  async function execute(change: StorageChange): Promise<void> {
    setIsBusy(true);
    setError(null);
    const reply = await requestStorageChange(change);
    setIsBusy(false);

    if (reply.ok) {
      setDialog(NO_DIALOG);
      onChanged();
      return;
    }

    const next = dialogForError(change, reply.error);

    if (next) {
      setDialog(next);
      return;
    }

    // The open dialog stays, so the person can correct the name or cancel.
    setError(reply.error);
  }

  return {
    dialog,
    error,
    isBusy,
    run: (change) => void execute(change),
    setDialog,
    setError,
  };
}

/**
 * Runs the changing operations of the Storage interface (PAGE-270) and leads
 * through their name conflicts and confirmations.
 *
 * @param options - The shown folder, the upload limit and the reload.
 * @returns The model of the toolbar, the row actions and the dialogs.
 *
 * @remarks
 * Nothing is changed without the server: a folder in the trash, a permanent
 * deletion and an overwrite always answer with a confirmation first, which
 * the dialog shows with its scope before it is repeated with the token.
 */
export function useStorageActions(
  options: StorageActionsOptions,
): StorageActionsModel {
  const { parentRef, maxUploadBytes, onChanged } = options;
  const runner = useChangeRunner(onChanged);
  const { dialog, run, setDialog, setError } = runner;

  function submitName(name: string): void {
    const change =
      dialog.kind === "name" ? nameChange(dialog, name, parentRef) : null;

    if (change) run(change);
  }

  function upload(file: File): void {
    if (maxUploadBytes !== null && file.size > maxUploadBytes) {
      setError({ code: "too_large", limitBytes: maxUploadBytes });
      return;
    }

    if (parentRef === null) return;

    run({
      fields: { onConflict: "fail", parentRef },
      file,
      operation: "upload",
    });
  }

  function repeat(fields: Readonly<Record<string, string>>): void {
    if (dialog.kind === "conflict" || dialog.kind === "confirm") {
      run(withFields(dialog.change, fields));
    }
  }

  function confirm(): void {
    if (dialog.kind === "confirm") {
      repeat({ confirmation: dialog.confirmation.token });
    }
  }

  function closeDialog(): void {
    setDialog(NO_DIALOG);
    setError(null);
  }

  return {
    closeDialog,
    confirm,
    deletePermanently: (target) =>
      run({ fields: { ref: target.ref }, operation: "delete_permanently" }),
    dialog,
    dismissError: () => setError(null),
    error: runner.error,
    isBusy: runner.isBusy,
    keepBoth: () => repeat({ onConflict: "keep_both" }),
    openNameDialog: (purpose, target) => {
      setError(null);
      setDialog({ kind: "name", purpose, target });
    },
    replace: () => repeat({ onConflict: "overwrite" }),
    restore: (target) =>
      run({ fields: { ref: target.ref }, operation: "restore" }),
    submitName,
    upload,
  };
}
