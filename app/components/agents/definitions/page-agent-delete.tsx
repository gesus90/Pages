import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { AgentAssignmentResult } from "@/app/components/settings/agents/agent-assignment-result";
import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

import type { AgentActionResult } from "@/app/lib/settings-actions/settings-agents-response.server";
import type { PageAgent } from "@/definition/PageAgent";

/** Confirms one owner deletion; React Router revalidates the list after the successful action. */
export function PageAgentDelete(props: {
  readonly agent: PageAgent;
  readonly onClose: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<AgentActionResult>();
  const { onClose } = props;
  const isPending = fetcher.state !== "idle";
  useEffect(() => {
    if (
      fetcher.state === "idle" &&
      fetcher.data?.ok &&
      fetcher.data.intent === "delete-agent"
    )
      onClose();
  }, [fetcher.state, fetcher.data, onClose]);
  function close(): void {
    if (!isPending) onClose();
  }
  return (
    <Dialog open onOpenChange={close}>
      <DialogContent size="md">
        <DialogTitle className="text-lg font-semibold">
          {t("pageAgents.deleteTitle", { name: props.agent.name })}
        </DialogTitle>
        <DialogDescription className="mt-1.5 text-sm text-muted-foreground">
          {t("pageAgents.deleteDescription")}
        </DialogDescription>
        <AgentAssignmentResult result={fetcher.data} />
        <fetcher.Form
          method="post"
          action="/agents/agents"
          className="mt-6 flex justify-end gap-2"
        >
          <input type="hidden" name="intent" value="delete-agent" />
          <input type="hidden" name="agentId" value={props.agent.id} />
          <input type="hidden" name="confirmation" value="LÖSCHEN" />
          <Button
            type="button"
            variant="ghost"
            disabled={isPending}
            onClick={close}
          >
            {t("settings.agents.cancel")}
          </Button>
          <Button type="submit" variant="destructive" disabled={isPending}>
            {t("pageAgents.confirmDelete")}
          </Button>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}
