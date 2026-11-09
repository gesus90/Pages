import { StorageActionDialogs } from "./storage-action-dialogs";
import { StorageActionError } from "./storage-action-notices";
import { StorageTrashView } from "./storage-trash-view";
import { useStorageActions } from "./use-storage-actions";
import { useStorageTrash } from "./use-storage-trash";

/**
 * The card of the trash with its own actions; it loads only while it is
 * open and reloads after every restore or permanent deletion.
 */
export function StorageTrashPanel({
  canWrite,
}: {
  readonly canWrite: boolean;
}): React.ReactElement {
  const trash = useStorageTrash();
  const actions = useStorageActions({
    maxUploadBytes: null,
    onChanged: trash.reload,
    parentRef: null,
  });
  const pageError = actions.dialog.kind === "none" ? actions.error : null;

  return (
    <>
      {pageError ? (
        <StorageActionError
          error={pageError}
          onDismiss={actions.dismissError}
        />
      ) : null}
      <div className="pages-content-card flex min-h-48 min-w-0 flex-1 flex-col overflow-hidden p-0">
        <StorageTrashView actions={actions} canWrite={canWrite} trash={trash} />
      </div>
      <StorageActionDialogs actions={actions} />
    </>
  );
}
