import { useReactFlow } from "@xyflow/react";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";

import { focusStatusNode } from "./plan-status-focus";
import { PlanCommandNote } from "./plan-command-note";
import { PlanStatusHeader } from "./plan-status-header";
import { PlanStatusDetails } from "./plan-status-details";
import { PlanStatusOutlook } from "./plan-status-outlook";
import { PlanAutomaticResumeNote } from "./plan-status-retry";
import { planNodeLabel } from "./plan-layout";
import { planSequencePreview, workGaps } from "./plan-run-status-model";
import { planStepSequence } from "./plan-step-sequence";
import { showsPass } from "./plan-status-sequence";
import { usePlanStatusTime } from "./use-plan-status-time";
import { keepPlanControlKeys } from "./plan-flow-keys";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { PlanCanvasProps } from "./plan-flow-context";
import type { PlanFlowEdge, PlanFlowNode } from "./plan-flow-model";
import type { PlanSequenceBlock } from "./plan-step-sequence";

interface PlanRunStatusProps {
  readonly canvas: PlanCanvasProps;
  readonly isOpen: boolean;
  readonly onToggle: () => void;
}

/** A single floating panel belongs to the authorized run; selection never controls the runner. */
export function PlanRunStatus(props: PlanRunStatusProps): React.ReactElement {
  return <RunStatusContent key={props.canvas.run?.id ?? "idle"} {...props} />;
}

/** The name of the node that blocked a waiting execution, from every record of the run. */
function blockerName(
  run: AgentPlanRun | null,
  block: PlanSequenceBlock | undefined,
): string | null {
  const blockedBy = block?.result?.blockedByStepId;
  if (!blockedBy || !run) return null;
  return (
    allPlanRunResults(run).find((entry) => entry.id === blockedBy)?.name ??
    blockedBy
  );
}

function StatusContent({
  block,
  run,
  number,
  hasPass,
  end,
  canLocate,
  onLocate,
}: {
  readonly block: PlanSequenceBlock | undefined;
  readonly run: AgentPlanRun | null;
  readonly number: number;
  readonly hasPass: boolean;
  readonly end: string | null;
  readonly canLocate: boolean;
  readonly onLocate: () => void;
}): React.ReactElement {
  const pass = block && hasPass ? block.pass : null;
  if (block && !block.result && block.kind !== "actual")
    return (
      <PlanStatusOutlook
        name={block.name}
        number={number}
        pass={pass}
        kind={block.kind}
        canLocate={canLocate}
        onLocate={onLocate}
      />
    );
  return (
    <>
      <PlanAutomaticResumeNote run={run} />
      <PlanStatusDetails
        step={block?.result}
        blockedByName={blockerName(run, block)}
        number={number}
        pass={pass}
        kind={block?.kind}
        end={end}
        canLocate={canLocate}
        onLocate={onLocate}
      />
    </>
  );
}

function RunStatusContent({
  canvas,
  isOpen,
  onToggle,
}: PlanRunStatusProps): React.ReactElement {
  const { t } = useTranslation();
  const flow = useReactFlow<PlanFlowNode, PlanFlowEdge>();
  const [chosenKey, choose] = useState<string | null>(null);
  const contentId = useId();
  const panel = useRef<HTMLElement>(null);
  const run = canvas.run;
  const plan = canvas.runPlan ?? canvas.draft;
  const sequence = planStepSequence(run, plan, (node) =>
    planNodeLabel(node, canvas.sources),
  );
  const selectedKey = sequence.blocks.some((block) => block.key === chosenKey)
    ? chosenKey
    : sequence.anchorKey;
  const index = sequence.blocks.findIndex((block) => block.key === selectedKey);
  const block: PlanSequenceBlock | undefined = sequence.blocks[index];
  const end = usePlanStatusTime(run);
  const target = block ? flow.getNode(block.nodeId) : undefined;
  function locate(): void {
    if (!target) return;
    canvas.graph.select(target.id);
    focusStatusNode(flow, target.id, panel.current);
  }
  return (
    <section
      ref={panel}
      data-plan-run-status
      aria-label={t("plans.progress.label")}
      onKeyDown={keepPlanControlKeys}
      className="pointer-events-auto absolute left-4 bottom-[calc(env(safe-area-inset-bottom)+8.5rem)] z-20 flex max-h-[min(26rem,36%)] w-[min(56.25rem,calc(100%-2rem))] @container/status flex-col overflow-hidden rounded-xl border border-border bg-surface text-foreground shadow-floating md:bottom-[calc(env(safe-area-inset-bottom)+1.5rem)] md:max-h-[min(21.25rem,58%)] md:w-[min(56.25rem,calc(100%-6.5rem))]"
    >
      <PlanStatusHeader
        run={run}
        sequence={sequence}
        gaps={workGaps(
          planSequencePreview(canvas.draft, canvas.sources, t),
          canvas.draft,
        )}
        end={end}
        selectedKey={selectedKey}
        isOpen={isOpen}
        contentId={contentId}
        error={canvas.runError ?? null}
        isReady={canvas.isReady}
        storedRunStatus={canvas.storedRunStatus}
        onSelect={choose}
        onToggle={onToggle}
      />
      <PlanCommandNote command={run?.command} />
      {isOpen ? (
        <div id={contentId} className="flex min-h-0 flex-col">
          <StatusContent
            block={run ? block : undefined}
            run={run}
            number={index + 1}
            hasPass={block ? showsPass(block, sequence.blocks) : false}
            end={end}
            canLocate={Boolean(target)}
            onLocate={locate}
          />
        </div>
      ) : null}
    </section>
  );
}
