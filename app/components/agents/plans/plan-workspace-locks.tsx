import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { useRegionFormatter } from "@/app/components/common/region-provider";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import type { AgentPlanWorkspaceLock } from "@/definition/AgentPlanWorkspaceLock";

/** Names all readable holders, including older runs and colliding plans. */
export function PlanWorkspaceLocks({
  entries,
}: {
  readonly entries: readonly AgentPlanWorkspaceLock[];
}): React.ReactElement {
  return (
    <>
      {entries.map((entry) => (
        <WorkspaceLock key={entry.runId} entry={entry} />
      ))}
    </>
  );
}

async function requestWorkspaceRelease(runId: string): Promise<string | null> {
  const response = await fetch("/agent-api/plan-runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "release_workspace_locks",
      runId,
      confirm: true,
    }),
  });
  if (response.ok) return null;
  const result: unknown = await response.json();
  return typeof result === "object" &&
    result !== null &&
    "error" in result &&
    typeof result.error === "string"
    ? result.error
    : "general";
}

function LockDetails({
  entry,
}: {
  readonly entry: AgentPlanWorkspaceLock;
}): React.ReactElement {
  const { t } = useTranslation();
  const { formatDateTime } = useRegionFormatter();
  return (
    <>
      <p>
        {t("plans.workspaceLocks.holder", {
          run: entry.runId,
          status: t(`plans.status.${entry.status}`),
          hours: Math.floor(entry.ageMilliseconds / 3_600_000),
          minutes: Math.floor(entry.ageMilliseconds / 60_000) % 60,
          since: formatDateTime(entry.acquiredAt),
        })}
      </p>
      <p>{t(`plans.workspaceLocks.reason.${entry.reason}`)}</p>
      <Link
        to={`/agents/plans?planId=${encodeURIComponent(entry.planId)}&runId=${encodeURIComponent(entry.runId)}`}
        className="inline-flex underline underline-offset-2 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:items-center"
      >
        {t("plans.workspaceLocks.showRun")}
      </Link>
      {entry.isOverdue ? (
        <p role="alert">{t("plans.workspaceLocks.overdue")}</p>
      ) : null}
    </>
  );
}

function WorkspaceLock({
  entry,
}: {
  readonly entry: AgentPlanWorkspaceLock;
}): React.ReactElement {
  const { t } = useTranslation();
  const [isPending, setPending] = useState(false);
  const [isReleased, setReleased] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function release(): Promise<void> {
    if (isPending || !window.confirm(t("plans.workspaceLocks.confirm"))) return;
    setPending(true);
    setError(null);
    try {
      const failure = await requestWorkspaceRelease(entry.runId);
      if (failure) setError(failure);
      else setReleased(true);
    } catch {
      setError("general");
    } finally {
      setPending(false);
    }
  }
  if (isReleased)
    return (
      <p role="status" className="px-4 pt-2 text-xs text-muted-foreground">
        {t("plans.workspaceLocks.released")}
      </p>
    );
  return (
    <div
      className={cn(
        "px-4 pt-2 text-xs wrap-anywhere",
        entry.isOverdue ? "text-warning" : "text-muted-foreground",
      )}
    >
      <LockDetails entry={entry} />
      {entry.canRelease ? (
        <Button
          size="sm"
          variant="outline"
          className="mt-2"
          disabled={isPending}
          onClick={() => void release()}
        >
          {t("plans.workspaceLocks.release")}
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1 text-destructive">
          {t([
            `plans.recovery.error.${error}`,
            `settings.agents.error.${error}`,
            "plans.panel.error",
          ])}
        </p>
      ) : null}
    </div>
  );
}
