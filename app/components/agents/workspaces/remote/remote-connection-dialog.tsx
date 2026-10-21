import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AgentDiscardDialog } from "@/app/components/settings/agents/agent-discard-dialog";
import { Button } from "@/app/components/ui/button";
import {
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";

import { RemoteActionMessage } from "./remote-action-message";
import { RemoteConnectionFields } from "./remote-connection-fields";
import { effectiveHostKey, hostKeyLabel } from "./remote-host-key";
import { RemoteTestPanel } from "./remote-test-panel";
import { useRemoteConnectionForm } from "./use-remote-connection-form";

import type { FormEvent } from "react";
import type { Department } from "@/definition/Authorization";
import type { RemoteConnectionView } from "@/definition/RemoteConnection";
import type { RemoteConnectionForm } from "./use-remote-connection-form";

/** Which host key a save keeps, so nobody stores a connection unaware that its key is unconfirmed. */
function RemoteHostKeyStatus(props: {
  readonly connection: RemoteConnectionView | null;
  readonly form: RemoteConnectionForm;
}): React.ReactElement {
  const { t } = useTranslation();
  const { hostKey, isDropped } = effectiveHostKey(
    props.connection,
    props.form.draft,
    props.form.confirmedHostKey,
  );
  if (!hostKey)
    return (
      <p className="text-xs text-muted-foreground">
        {t(isDropped ? "remote.test.dropped" : "remote.test.none")}
      </p>
    );
  return (
    <p className="flex items-start gap-2 text-xs text-muted-foreground">
      <ShieldCheck
        className="mt-0.5 size-3.5 shrink-0 text-success"
        aria-hidden="true"
      />
      <span className="min-w-0">
        {t(
          props.form.confirmedHostKey
            ? "remote.test.pinnedPending"
            : "remote.test.pinned",
        )}{" "}
        <span className="pages-selectable font-mono break-all">
          {hostKeyLabel(hostKey)} · {hostKey.fingerprint}
        </span>
      </span>
    </p>
  );
}

/**
 * Adds or edits an SSH connection in the centered Pages dialog.
 *
 * @remarks
 * Sharing is the department field of the same dialog; there is no separate
 * sharing window. "Test connection" sits bottom left, cancel and save bottom
 * right.
 */
export function RemoteConnectionDialog(props: {
  readonly connection: RemoteConnectionView | null;
  readonly departments: readonly Department[];
  readonly onClose: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const form = useRemoteConnectionForm(props.connection, props.onClose);
  const isBusy = form.isSaving || form.isTesting;
  const canTest =
    form.draft.host.trim() !== "" && form.draft.username.trim() !== "";
  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    form.save();
  }
  return (
    <DialogContent
      size="lg"
      className="flex max-h-[90dvh] flex-col"
      onEscapeKeyDown={form.guardDismiss}
      onPointerDownOutside={form.guardDismiss}
    >
      <DialogTitle className="text-lg font-semibold">
        {t(
          props.connection
            ? "remote.dialog.editTitle"
            : "remote.dialog.addTitle",
        )}
      </DialogTitle>
      <DialogDescription className="mt-1.5 text-sm text-muted-foreground">
        {t("remote.dialog.description")}
      </DialogDescription>
      <form onSubmit={handleSubmit} className="mt-5 flex min-h-0 flex-col">
        <VerticalScrollArea
          className="min-h-0 flex-1"
          contentClassName="space-y-4 px-1 pt-1 pb-6"
        >
          <RemoteConnectionFields
            draft={form.draft}
            departments={props.departments}
            storedSecrets={props.connection?.storedSecrets ?? null}
            disabled={form.isSaving}
            onChange={form.setDraft}
          />
          <RemoteHostKeyStatus connection={props.connection} form={form} />
          <RemoteTestPanel
            test={form.test}
            result={form.testResult}
            isTesting={form.isTesting}
            onConfirm={form.confirmHostKey}
          />
          <RemoteActionMessage result={form.saveResult} />
        </VerticalScrollArea>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
          <Button
            variant="outline"
            disabled={isBusy || !canTest}
            isPending={form.isTesting}
            onClick={form.runTest}
          >
            {t("remote.dialog.test")}
          </Button>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              disabled={form.isSaving}
              onClick={form.requestClose}
            >
              {t("remote.dialog.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={isBusy || !form.isComplete}
              isPending={form.isSaving}
            >
              {t(props.connection ? "remote.dialog.save" : "remote.dialog.add")}
            </Button>
          </div>
        </div>
      </form>
      <AgentDiscardDialog
        open={form.shouldConfirmClose}
        onOpenChange={form.setConfirmClose}
        onDiscard={props.onClose}
      />
    </DialogContent>
  );
}
