import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import type { AgentWorkspaceCleanup } from "@/definition/AgentWorkspaceCleanup";

/** Shows retained cleanup evidence and requires an explicit human attestation before release. */
export function PlanWorkspaceCleanup({
  entries,
  planId,
}: {
  readonly entries: readonly AgentWorkspaceCleanup[];
  readonly planId: string;
}): React.ReactElement {
  return (
    <>
      {entries.map((entry) => (
        <CleanupEntry
          key={`${entry.workspaceId}:${entry.runId}`}
          entry={entry}
          planId={planId}
        />
      ))}
    </>
  );
}

function CleanupEntry({
  entry,
  planId,
}: {
  readonly entry: AgentWorkspaceCleanup;
  readonly planId: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState(false);
  async function decide(action: "retry" | "release"): Promise<void> {
    if (
      action === "release" &&
      !window.confirm(t("plans.recovery.cleanupReleaseConfirm"))
    )
      return;
    setIsPending(true);
    setError(false);
    try {
      const response = await fetch("/agent-api/plan-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId,
          runId: entry.runId,
          workspaceId: entry.workspaceId,
          action,
          processEndVerified: action === "release",
        }),
      });
      if (!response.ok) throw new Error("Cleanup decision refused");
    } catch {
      setError(true);
    } finally {
      setIsPending(false);
    }
  }
  return (
    <div role="status" className="px-4 pt-2 text-xs wrap-anywhere text-warning">
      <p>
        {t("plans.recovery.cleanupObligation", {
          workspace: entry.workspaceName,
          run: entry.runId,
        })}{" "}
        {entry.state === "needs_decision"
          ? t("plans.recovery.cleanupNeedsDecision")
          : null}{" "}
        {t(`plans.recovery.cleanupBlocker.${entry.blocker}`, {
          defaultValue: entry.blocker,
        })}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() => void decide("retry")}
        >
          {t("plans.recovery.cleanupRetry")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() => void decide("release")}
        >
          {t("plans.recovery.cleanupRelease")}
        </Button>
      </div>
      {error ? (
        <p role="alert">{t("plans.recovery.cleanupDecisionFailed")}</p>
      ) : null}
    </div>
  );
}
