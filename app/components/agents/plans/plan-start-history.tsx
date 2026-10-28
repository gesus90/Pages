import { useState } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import { PlanStartRejection } from "./plan-start-rejection";

import type { AgentPlanStartRejectionPage } from "@/definition/AgentPlanStartRejection";

interface HistoryResponse {
  readonly ok: boolean;
  readonly planId?: string;
  readonly history?: AgentPlanStartRejectionPage;
}

/** Reads older own refusals explicitly without changing current controls or the draft. */
export function PlanStartHistory({
  planId,
  latestId,
}: {
  readonly planId: string;
  readonly latestId: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<HistoryResponse>();
  const [requestedBefore, setRequestedBefore] = useState(latestId);
  const response = fetcher.data;
  const history =
    response?.ok && response.planId === planId ? response.history : undefined;
  const before = history ? history.nextBefore : requestedBefore;

  function loadOlder(): void {
    if (!before) return;
    setRequestedBefore(before);
    const query = new URLSearchParams({
      planId,
      startRejections: "true",
      before,
    });
    void fetcher.load(`/agent-api/plan-runs?${query.toString()}`);
  }

  return (
    <section className="space-y-2">
      {history?.entry ? (
        <PlanStartRejection rejection={history.entry} isHistorical />
      ) : null}
      {response?.ok === false ? (
        <p role="alert" className="text-xs text-destructive">
          {t("plans.panel.historyFailed")}
        </p>
      ) : null}
      {before ? (
        <Button
          size="xs"
          variant="outline"
          disabled={fetcher.state !== "idle"}
          onClick={loadOlder}
        >
          {t("plans.panel.olderStartRejection")}
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t("plans.panel.historyEnd")}
        </p>
      )}
    </section>
  );
}
