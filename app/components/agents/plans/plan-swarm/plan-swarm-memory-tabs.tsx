import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Tabs, TabsContent } from "@/app/components/ui/tabs";

import { PlanSwarmActivityTab } from "./plan-swarm-activity";
import { PlanSwarmMemoryTab } from "./plan-swarm-memory";
import { PlanSwarmRun } from "./plan-swarm-run";
import { usePlanSwarmMemory } from "./use-plan-swarm-memory";

import type { AgentPlanSwarmRun } from "@/definition/AgentPlanSwarmRun";
import type { AgentPlanSwarmMemoryView } from "@/definition/AgentPlanSwarmMemory";
import type { PlanSwarmMemoryState } from "./use-plan-swarm-memory";

type PlanSwarmRunTab = "workers" | "memory" | "activity";

/** Placeholder lines while the memory loads, like the lanes of a loading run. */
function LoadingMemory(): React.ReactElement {
  const { t } = useTranslation();
  return (
    <ul
      aria-busy="true"
      aria-label={t("plans.swarm.memory.loading")}
      data-plan-swarm-memory-loading
    >
      {[0, 1, 2].map((index) => (
        <li
          key={index}
          className="flex h-13 items-center border-t border-border px-3 first:border-t-0"
        >
          <span className="h-3 w-full rounded bg-muted motion-safe:animate-pulse" />
        </li>
      ))}
    </ul>
  );
}

/** The bar of a failed load with a retry; the lanes in the tab Helfer stay readable. */
function MemoryFailure(props: {
  readonly onRetry: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-2 border-b border-destructive/40 bg-destructive-subtle px-3 py-2 text-xs text-destructive"
      data-plan-swarm-memory-error
    >
      <span>{t("plans.swarm.memory.failed")}</span>
      <Button type="button" variant="outline" size="xs" onClick={props.onRetry}>
        {t("plans.swarm.memory.retry")}
      </Button>
    </div>
  );
}

/** Shows a memory tab once loaded, its placeholder while it loads and the bar when it failed. */
function MemoryState(props: {
  readonly state: PlanSwarmMemoryState;
  readonly onRetry: () => void;
  readonly children: (memory: AgentPlanSwarmMemoryView) => React.ReactNode;
}): React.ReactElement {
  const { state } = props;
  return (
    <section className="@container/swarm flex min-w-0 flex-col overflow-hidden rounded-lg border border-border">
      {state.status === "loading" ? <LoadingMemory /> : null}
      {state.status === "error" ? (
        <MemoryFailure onRetry={props.onRetry} />
      ) : null}
      {state.status === "ready" ? props.children(state.memory) : null}
    </section>
  );
}

/**
 * The run view of a swarm, with the tabs Helfer, Gedächtnis and Aktivitäten
 * when the run has a shared memory; without one only the lanes.
 */
export function PlanSwarmRunTabs(props: {
  readonly runId: string;
  readonly stepId: string;
  readonly run: AgentPlanSwarmRun | undefined;
  readonly workerCount: number;
  readonly error?: string | null;
}): React.ReactElement {
  const { t } = useTranslation();
  const [tab, setTab] = useState<PlanSwarmRunTab>("workers");
  const revision = props.run?.memory?.revision ?? null;
  const { state, retry } = usePlanSwarmMemory({
    runId: props.runId,
    stepId: props.stepId,
    revision: revision ?? 0,
    isOpen: revision !== null && tab !== "workers",
  });
  const lanes = (
    <PlanSwarmRun
      run={props.run}
      workerCount={props.workerCount}
      error={props.error}
    />
  );
  if (revision === null) return lanes;
  function handleTab(next: string): void {
    if (next === "workers" || next === "memory" || next === "activity")
      setTab(next);
  }
  return (
    <Tabs
      value={tab}
      onValueChange={handleTab}
      ariaLabel={t("plans.swarm.memory.tabs")}
      className="gap-2"
      tabs={[
        { value: "workers", label: t("plans.swarm.memory.tab.workers") },
        { value: "memory", label: t("plans.swarm.memory.tab.memory") },
        { value: "activity", label: t("plans.swarm.memory.tab.activity") },
      ]}
    >
      <TabsContent value="workers">{lanes}</TabsContent>
      <TabsContent value="memory">
        <MemoryState state={state} onRetry={retry}>
          {(memory) => (
            <PlanSwarmMemoryTab
              memory={memory}
              runId={props.runId}
              stepId={props.stepId}
            />
          )}
        </MemoryState>
      </TabsContent>
      <TabsContent value="activity">
        <MemoryState state={state} onRetry={retry}>
          {(memory) => <PlanSwarmActivityTab memory={memory} />}
        </MemoryState>
      </TabsContent>
    </Tabs>
  );
}
