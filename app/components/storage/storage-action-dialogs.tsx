import { StorageActionError } from "./storage-action-notices";
import { StorageConfirmDialog } from "./storage-confirm-dialog";
import { StorageConflictDialog } from "./storage-conflict-dialog";
import { StorageNameDialog } from "./storage-name-dialog";

import type { StorageActionsModel } from "./use-storage-actions";

/**
 * The dialogs of the Storage actions: the name prompt, the name conflict and
 * the confirmation; at most one is open.
 */
export function StorageActionDialogs({
  actions,
}: {
  readonly actions: StorageActionsModel;
}): React.ReactElement {
  const { dialog, isBusy, closeDialog } = actions;
  const error =
    actions.error === null ? null : (
      <StorageActionError error={actions.error} />
    );

  return (
    <>
      <StorageNameDialog
        error={error}
        initialName={dialog.kind === "name" ? (dialog.target?.name ?? "") : ""}
        isBusy={isBusy}
        onCancel={closeDialog}
        onSubmit={actions.submitName}
        purpose={dialog.kind === "name" ? dialog.purpose : null}
      />
      <StorageConflictDialog
        canReplace={dialog.kind === "conflict" && dialog.canReplace}
        conflicts={dialog.kind === "conflict" ? dialog.conflicts : []}
        error={error}
        isBusy={isBusy}
        isOpen={dialog.kind === "conflict"}
        onCancel={closeDialog}
        onKeepBoth={actions.keepBoth}
        onReplace={actions.replace}
      />
      <StorageConfirmDialog
        confirmation={dialog.kind === "confirm" ? dialog.confirmation : null}
        error={error}
        isBusy={isBusy}
        isRefreshed={dialog.kind === "confirm" && dialog.isRefreshed}
        onCancel={closeDialog}
        onConfirm={actions.confirm}
      />
    </>
  );
}
