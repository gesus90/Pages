import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSubmit } from "react-router";

import { Button } from "@/app/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/app/components/ui/dialog";
import {
  useUsersActionData,
  useUsersError,
  useIsSubmitting,
} from "@/app/components/users/use-users-action";
import { backendRequestHeaders } from "@/app/lib/backend-request";
import { AgentDeletePreview } from "./agent-delete-preview";

import type { AgentDeletionPreview } from "@/definition/AgentDeletion";

function isPreview(input: unknown): input is AgentDeletionPreview {
  return (
    typeof input === "object" &&
    input !== null &&
    "previewId" in input &&
    typeof input.previewId === "string" &&
    "deletes" in input &&
    "keeps" in input &&
    "blockers" in input
  );
}

interface AgentDeleteDialogProps {
  readonly agentId: string;
  readonly onClose: () => void;
}

/** Shows the saved deletion preview and sends confirmation only on the Delete button. */
export function AgentDeleteDialog({
  agentId,
  onClose,
}: AgentDeleteDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const submit = useSubmit();
  const [preview, setPreview] = useState<AgentDeletionPreview | null>(null);
  const [failed, setFailed] = useState(false);
  const result = useUsersActionData();
  const error = useUsersError("delete-agent");
  const isSubmitting = useIsSubmitting("delete-agent");

  useEffect(() => {
    const controller = new AbortController();
    void fetch(
      `/users-api/agents/${encodeURIComponent(agentId)}/deletion-preview`,
      {
        headers: backendRequestHeaders({ Accept: "application/json" }),
        signal: controller.signal,
        cache: "no-store",
      },
    )
      .then(async (response) => {
        const answer: unknown = await response.json();
        if (!controller.signal.aborted && response.ok && isPreview(answer))
          setPreview(answer);
        else if (!controller.signal.aborted) setFailed(true);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        console.warn(
          "[pages] The agent deletion preview could not be read.",
          caught,
        );
        setFailed(true);
      });
    return () => controller.abort();
  }, [agentId]);

  useEffect(() => {
    if (
      result?.intent === "delete-agent" &&
      result.ok &&
      result.agentId === agentId
    )
      onClose();
  }, [result, agentId, onClose]);

  function confirm(): void {
    if (!preview || preview.blockers.length > 0) return;
    const formData = new FormData();
    formData.set("intent", "delete-agent");
    formData.set("agentId", agentId);
    formData.set("previewId", preview.previewId);
    formData.set("operationId", crypto.randomUUID());
    void submit(formData, { method: "post" });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent size="md">
        <DialogTitle className="text-lg font-semibold text-foreground">
          {t("agentEmployees.deletion.title", {
            name: preview?.displayName ?? "",
          })}
        </DialogTitle>
        {failed ? (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {t("agentEmployees.deletion.loadFailed")}
          </p>
        ) : null}
        {!preview && !failed ? (
          <p className="mt-4 text-sm text-muted-foreground">
            {t("agentEmployees.deletion.loading")}
          </p>
        ) : null}
        {preview ? <AgentDeletePreview preview={preview} /> : null}
        {error ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {t("agentEmployees.deletion.failed")}
          </p>
        ) : null}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("agentEmployees.deletion.cancel")}
          </Button>
          <Button
            className="bg-destructive text-primary-foreground hover:bg-destructive/90"
            disabled={!preview || preview.blockers.length > 0 || isSubmitting}
            onClick={confirm}
          >
            {t("agentEmployees.deletion.confirm")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
