import { useReactFlow } from "@xyflow/react";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { expandPlanGroups } from "@/definition/AgentPlanGroup";

import { planNodeLabel } from "./plan-layout";
import { focusStatusNode } from "./plan-status-focus";
import { PlanStatusHeader } from "./plan-status-header";
import { PlanStatusDetails } from "./plan-status-details";
import { statusAnchor, statusSteps } from "./plan-run-status-model";
import { usePlanStatusTime } from "./use-plan-status-time";
import { keepPlanControlKeys } from "./plan-flow-keys";

import type { PlanCanvasProps } from "./plan-flow-context";
import type { PlanFlowEdge, PlanFlowNode } from "./plan-flow-model";

interface PlanRunStatusProps {
  readonly canvas: PlanCanvasProps;
  readonly isOpen: boolean;
  readonly onToggle: () => void;
}

/** A single floating panel belongs to the authorized run; selection never controls the runner. */
export function PlanRunStatus(props: PlanRunStatusProps): React.ReactElement {
  return <RunStatusContent key={props.canvas.run?.id ?? "idle"} {...props} />;
}

function RunStatusContent({
  canvas,
  isOpen,
  onToggle,
}: PlanRunStatusProps): React.ReactElement {
  const { t } = useTranslation();
  const flow = useReactFlow<PlanFlowNode, PlanFlowEdge>();
  const [chosenId, choose] = useState<string | null>(null);
  const contentId = useId();
  const panel = useRef<HTMLElement>(null);
  const run = canvas.run;
  const steps = statusSteps(run);
  const anchorId = statusAnchor(run, steps);
  const selectedId = steps.some((step) => step.id === chosenId)
    ? chosenId
    : anchorId;
  const step = steps.find((entry) => entry.id === selectedId);
  const end = usePlanStatusTime(run);
  const target = step ? flow.getNode(step.id) : undefined;
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
      className="pointer-events-auto absolute left-4 bottom-[calc(env(safe-area-inset-bottom)+8.5rem)] z-20 flex max-h-[min(26rem,36%)] w-[min(56.25rem,calc(100%-2rem))] @container/status flex-col rounded-lg border border-border bg-plan-progress-surface/90 text-foreground shadow-floating backdrop-blur-md md:bottom-[calc(env(safe-area-inset-bottom)+1.5rem)] md:max-h-[min(21.25rem,58%)] md:w-[min(56.25rem,calc(100%-6.5rem))]"
    >
      <PlanStatusHeader
        run={run}
        steps={steps}
        previewNames={expandPlanGroups(canvas.draft)
          .nodes.filter((node) =>
            ["start", "end", "agent", "script", "loop"].includes(node.type),
          )
          .map((node) => planNodeLabel(node, canvas.sources))}
        end={end}
        anchorId={anchorId}
        selectedId={selectedId}
        isOpen={isOpen}
        contentId={contentId}
        error={canvas.runError ?? null}
        onSelect={choose}
        onToggle={onToggle}
      />
      {isOpen ? (
        <div id={contentId} className="flex min-h-0 flex-col">
          <PlanStatusDetails
            step={step}
            number={steps.findIndex((entry) => entry.id === selectedId) + 1}
            end={end}
            canLocate={Boolean(target)}
            onLocate={locate}
          />
        </div>
      ) : null}
    </section>
  );
}
