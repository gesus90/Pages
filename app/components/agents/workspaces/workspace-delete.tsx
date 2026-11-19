import { useEffect, useState } from "react";
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

import { RemoteActionMessage } from "./remote/remote-action-message";

import type { AgentActionResult } from "@/app/lib/settings-actions/settings-agents-response.server";
import type {
  AgentWorkspaceUsage,
  AgentWorkspaceUsageKind,
  AgentWorkspaceView,
} from "@/definition/AgentWorkspace";
import type { RemoteActionResult } from "@/definition/RemoteConnection";

type RemovalResult = AgentActionResult | RemoteActionResult;

function canRemoveWorkspace(
  usages: readonly { readonly kind: string }[] | undefined,
  isConfirmed: boolean,
): boolean {
  if (!usages) return false;
  return usages.length === 0 || isConfirmed;
}

function RemovalError({
  result,
}: {
  readonly result: RemovalResult | undefined;
}): React.ReactElement | null {
  if (!result || result.ok) return null;
  return "failure" in result ? (
    <RemoteActionMessage result={result} />
  ) : (
    <AgentAssignmentResult result={result} />
  );
}

/** Confirms detaching references before unregistering local or remote metadata; active runs remain protected. */
export function WorkspaceDelete(props: {
  readonly workspace: Pick<AgentWorkspaceView, "id" | "name" | "revision">;
  readonly location?: "remote";
  readonly onClose: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<RemovalResult>();
  const [isConfirmed, setConfirmed] = useState(false);
  const { submit } = fetcher;
  const { onClose, workspace } = props;
  const isRemote = props.location === "remote";
  const action = isRemote ? "/agents/workspaces/remote" : "/agents/workspaces";
  const usageIntent = isRemote ? "remote-workspace-usages" : "workspace-usages";
  const deleteIntent = isRemote
    ? "delete-remote-workspace"
    : "delete-workspace";
  useEffect(() => {
    void submit(
      { intent: usageIntent, workspaceId: workspace.id },
      { method: "post", action },
    );
  }, [submit, workspace.id, usageIntent, action]);
  useEffect(() => {
    if (
      fetcher.state === "idle" &&
      fetcher.data?.ok &&
      fetcher.data.intent === deleteIntent
    )
      onClose();
  }, [fetcher.state, fetcher.data, deleteIntent, onClose]);
  const usages = fetcher.data?.ok ? fetcher.data.workspaceUsages : undefined;
  const isPending = fetcher.state !== "idle";
  const needsConfirmation = usages !== undefined && usages.length > 0;
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent size="md">
        <DialogTitle className="text-lg font-semibold wrap-anywhere">
          {t("workspaces.unregisterTitle", { name: workspace.name })}
        </DialogTitle>
        <DialogDescription className="mt-1.5 text-sm text-muted-foreground">
          {t("workspaces.unregisterDescription")}
        </DialogDescription>
        {isPending ? (
          <p role="status" className="mt-4 text-sm">
            {t("settings.agents.loading")}
          </p>
        ) : null}
        {usages ? <WorkspaceDeleteReferences usages={usages} /> : null}
        <RemovalError result={fetcher.data} />
        <fetcher.Form method="post" action={action} className="mt-5 space-y-4">
          <input type="hidden" name="intent" value={deleteIntent} />
          <input type="hidden" name="workspaceId" value={workspace.id} />
          <input type="hidden" name="revision" value={workspace.revision} />
          {needsConfirmation ? (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                required
                checked={isConfirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                className="mt-1 accent-primary"
              />
              <span>{t("workspaces.confirmDetach")}</span>
            </label>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={isPending}
              onClick={onClose}
            >
              {t("settings.agents.cancel")}
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={isPending || !canRemoveWorkspace(usages, isConfirmed)}
            >
              {t("workspaces.unregister")}
            </Button>
          </div>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}

interface UsageEntry {
  readonly key: string;
  readonly kind: AgentWorkspaceUsageKind;
  readonly name: string | null;
  readonly count: number;
}

function toUsageEntries(
  usages: readonly AgentWorkspaceUsage[],
): readonly UsageEntry[] {
  const entries: UsageEntry[] = [];
  const anonymous = new Map<AgentWorkspaceUsageKind, number>();
  for (const usage of usages) {
    if (usage.name !== null)
      entries.push({
        key: `${usage.kind}:${usage.id}`,
        kind: usage.kind,
        name: usage.name,
        count: 1,
      });
    else anonymous.set(usage.kind, (anonymous.get(usage.kind) ?? 0) + 1);
  }
  for (const [kind, count] of anonymous)
    entries.push({ key: kind, kind, name: null, count });
  return entries;
}

function UsageLabel({
  entry,
}: {
  readonly entry: UsageEntry;
}): React.ReactElement {
  const { t } = useTranslation();
  if (entry.name !== null) return <>{entry.name}</>;
  const kind = t(`workspaces.usageKind.${entry.kind}`);
  return (
    <>
      {entry.count > 1
        ? t("workspaces.usageKindCount", { kind, count: entry.count })
        : kind}
    </>
  );
}

function WorkspaceDeleteReferences({
  usages,
}: {
  readonly usages: readonly AgentWorkspaceUsage[];
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (usages.length === 0) return null;
  return (
    <div className="mt-4 space-y-3">
      <p className="text-sm text-warning">
        {t("workspaces.detachDescription")}
      </p>
      <VerticalScrollArea className="max-h-44" contentClassName="pb-2">
        <p className="text-sm font-medium">{t("workspaces.usedBy")}</p>
        <ul className="pages-selectable mt-2 space-y-1 text-sm wrap-anywhere">
          {toUsageEntries(usages).map((entry) => (
            <li key={entry.key}>
              <UsageLabel entry={entry} />
            </li>
          ))}
        </ul>
      </VerticalScrollArea>
      {usages.some((usage) => usage.kind === "run") ? (
        <p role="alert" className="text-sm text-destructive">
          {t("workspaces.cleanupPending")}
        </p>
      ) : null}
    </div>
  );
}
