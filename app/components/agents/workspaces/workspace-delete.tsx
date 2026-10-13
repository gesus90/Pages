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
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";

import type { AgentActionResult } from "@/app/lib/settings-actions/settings-agents-response.server";
import type {
  AgentWorkspaceUsage,
  AgentWorkspaceUsageKind,
  AgentWorkspaceView,
} from "@/definition/AgentWorkspace";

interface UsageEntry {
  readonly key: string;
  readonly kind: AgentWorkspaceUsageKind;
  readonly name: string;
  readonly count: number;
}

/** Keeps named references as they are and counts the anonymous ones per kind. */
function toUsageEntries(
  usages: readonly AgentWorkspaceUsage[],
): readonly UsageEntry[] {
  const entries: UsageEntry[] = [];
  const anonymous = new Map<AgentWorkspaceUsageKind, number>();
  for (const usage of usages) {
    if (usage.name)
      entries.push({
        key: `${usage.kind}:${usage.id}`,
        kind: usage.kind,
        name: usage.name,
        count: 1,
      });
    else anonymous.set(usage.kind, (anonymous.get(usage.kind) ?? 0) + 1);
  }
  for (const [kind, count] of anonymous)
    entries.push({ key: kind, kind, name: "", count });
  return entries;
}

function UsageLabel({
  entry,
}: {
  readonly entry: UsageEntry;
}): React.ReactElement {
  const { t } = useTranslation();
  if (entry.name) return <>{entry.name}</>;
  const kind = t(`workspaces.usageKind.${entry.kind}`);
  return (
    <>
      {entry.count > 1
        ? t("workspaces.usageKindCount", { kind, count: entry.count })
        : kind}
    </>
  );
}

/** Confirms removal of an unused registration; it never offers directory or GitHub changes. */
export function WorkspaceDelete(props: {
  readonly workspace: AgentWorkspaceView;
  readonly onClose: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<AgentActionResult>();
  const { submit } = fetcher;
  const { onClose } = props;
  const id = props.workspace.id;
  useEffect(() => {
    void submit(
      { intent: "workspace-usages", workspaceId: id },
      { method: "post", action: "/agents/workspaces" },
    );
  }, [submit, id]);
  useEffect(() => {
    if (
      fetcher.state === "idle" &&
      fetcher.data?.ok &&
      fetcher.data.intent === "delete-workspace"
    )
      onClose();
  }, [fetcher.state, fetcher.data, onClose]);
  const usages = fetcher.data?.ok ? fetcher.data.workspaceUsages : undefined;
  const isPending = fetcher.state !== "idle";
  return (
    <Dialog open onOpenChange={props.onClose}>
      <DialogContent size="md">
        <DialogTitle className="text-lg font-semibold">
          {t("workspaces.unregisterTitle", { name: props.workspace.name })}
        </DialogTitle>
        <DialogDescription className="mt-1.5 text-sm text-muted-foreground">
          {t("workspaces.unregisterDescription")}
        </DialogDescription>
        {isPending ? (
          <p role="status" className="mt-4 text-sm">
            {t("settings.agents.loading")}
          </p>
        ) : null}
        {usages?.length ? (
          <VerticalScrollArea
            className="mt-4 max-h-60"
            contentClassName="pb-10"
          >
            <p className="text-sm font-medium">{t("workspaces.usedBy")}</p>
            <ul className="pages-selectable mt-2 space-y-1 text-sm">
              {toUsageEntries(usages).map((entry) => (
                <li key={entry.key}>
                  <UsageLabel entry={entry} />
                </li>
              ))}
            </ul>
          </VerticalScrollArea>
        ) : null}
        {fetcher.data?.ok === false ? (
          <AgentAssignmentResult result={fetcher.data} />
        ) : null}
        <fetcher.Form
          method="post"
          action="/agents/workspaces"
          className="mt-6 flex justify-end gap-2"
        >
          <input type="hidden" name="intent" value="delete-workspace" />
          <input type="hidden" name="workspaceId" value={id} />
          <input
            type="hidden"
            name="revision"
            value={props.workspace.revision}
          />
          <Button
            type="button"
            variant="ghost"
            disabled={isPending}
            onClick={props.onClose}
          >
            {t("settings.agents.cancel")}
          </Button>
          <Button
            type="submit"
            variant="destructive"
            disabled={isPending || usages === undefined || usages.length > 0}
          >
            {t("workspaces.unregister")}
          </Button>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}
