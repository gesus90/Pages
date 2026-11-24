import { useReactFlow } from "@xyflow/react";
import { Crosshair } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useRegionFormatter } from "@/app/components/common/region-provider";
import { Button } from "@/app/components/ui/button";
import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";
import { isActivePlanRun } from "@/definition/AgentPlanRunState";

import { PlanInvocationNote } from "./plan-jump/plan-jump-run";
import { stepReportedAt } from "./plan-agent-todo-model";
import { PlanStartFailure } from "./plan-start-failure";
import { PlanStatusHeader } from "./plan-status-header";
import { PlanStatusDetails } from "./plan-status-details";
import { PlanAutomaticResumeNote } from "./plan-status-retry";
import { planNodeLabel } from "./plan-layout";
import { planSequencePreview, workGaps } from "./plan-run-status-model";
import { planStepSequence } from "./plan-step-sequence";
import { showsPass } from "./plan-status-sequence";
import { keepPlanControlKeys } from "./plan-flow-keys";

import type { ReactFlowInstance } from "@xyflow/react";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { PlanRunCommandReceipt } from "@/definition/PagesRuns";
import type { PlanCanvasProps } from "./plan-flow-context";
import type { PlanFlowEdge, PlanFlowNode } from "./plan-flow-model";
import type {
  PlanSequenceBlock,
  PlanSequenceBlockKind,
  PlanStepSequence,
} from "./plan-step-sequence";
import type { PlanWorkspaceWait } from "./plan-workspace-wait-model";

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
        runStatus={run?.status}
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
        workspaceWait={canvas.workspaceWait}
        onSelect={choose}
        onToggle={onToggle}
      />
      <PlanStatusNow
        run={run}
        sequence={sequence}
        workspaceWait={canvas.workspaceWait}
      />
      <PlanCommandNote command={run?.command} />
      <PlanInvocationNote invocation={run?.invocation} />
      <PlanStartFailure error={run?.startError} />
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

function usePlanStatusTime(run: AgentPlanRun | null): string | null {
  const [now, setNow] = useState<string | null>(null);
  const isActive = run !== null && isActivePlanRun(run.status);
  useEffect(() => {
    if (!isActive) return;
    setNow(new Date().toISOString());
    const timer = window.setInterval(
      () => setNow(new Date().toISOString()),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [isActive, run?.id]);
  return isActive ? now : (run?.endedAt ?? null);
}

function PlanCommandNote({
  command,
}: {
  readonly command: PlanRunCommandReceipt | undefined;
}): React.ReactElement | null {
  const { t, i18n } = useTranslation();
  if (!command || command.status === "applied") return null;
  const errorKey = `settings.agents.error.${command.error}`;
  return (
    <p
      role="status"
      className="border-t border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground"
    >
      {t(`plans.command.${command.status}`, {
        action: t(`plans.command.action.${command.action}`),
      })}
      {command.error && i18n.exists(errorKey) ? ` ${t(errorKey)}` : null}
    </p>
  );
}

function canvasRightEdge(
  panel: HTMLElement,
  bounds: DOMRect,
  top: number,
): number {
  const palette = panel.parentElement
    ?.querySelector("[data-plan-palette]")
    ?.getBoundingClientRect();
  if (palette && palette.bottom > bounds.top + top)
    return palette.left - bounds.left - 16;
  return bounds.width - 16;
}

function focusStatusNode(
  flow: ReactFlowInstance<PlanFlowNode, PlanFlowEdge>,
  id: string,
  panel: HTMLElement | null,
): void {
  const node = flow.getInternalNode(id);
  const bounds = panel?.parentElement?.getBoundingClientRect();
  if (!node || !panel || !bounds) return;
  const upper = panel.parentElement
    ?.querySelector("[data-plan-upper-stack]")
    ?.getBoundingClientRect();
  const top = Math.max(16, (upper?.bottom ?? bounds.top) - bounds.top + 16);
  const bottom = panel.getBoundingClientRect().top - bounds.top - 16;
  const right = canvasRightEdge(panel, bounds, top);
  const width = node.measured.width ?? 280;
  const height = node.measured.height ?? 200;
  const zoom = Math.max(
    0.01,
    Math.min(
      1,
      Math.max(48, right - 16) / (width + 32),
      Math.max(48, bottom - top) / (height + 32),
    ),
  );
  const position = node.internals.positionAbsolute;
  void flow.setViewport({
    x: (16 + right) / 2 - (position.x + width / 2) * zoom,
    y: (top + bottom) / 2 - (position.y + height / 2) * zoom,
    zoom,
  });
}

function PlanStatusOutlook({
  name,
  number,
  pass,
  kind,
  canLocate,
  onLocate,
}: {
  readonly name: string;
  readonly number: number;
  readonly pass: number | null;
  readonly kind: Exclude<PlanSequenceBlockKind, "actual">;
  readonly canLocate: boolean;
  readonly onLocate: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <section
      aria-label={t("plans.progress.step", { number })}
      className="flex flex-col gap-1 border-t border-border px-4 py-3 text-xs leading-4.5"
    >
      <h3 className="text-sm leading-5 font-semibold wrap-anywhere">
        {t("plans.progress.step", { number })} · {name}
        {pass ? ` · ${t("plans.progress.pass", { pass })}` : null}
      </h3>
      <p className="text-muted-foreground wrap-anywhere">
        {t(`plans.progress.outlook.${kind}`)}
      </p>
      <Button
        size="sm"
        variant="ghost"
        className="mt-1 h-auto min-h-8 max-w-full justify-start self-start rounded-md px-0 text-xs leading-4.5 text-muted-foreground whitespace-normal xl:min-h-8 xl:px-0 xl:text-xs [@media(pointer:coarse)]:min-h-11"
        onClick={onLocate}
        disabled={!canLocate}
      >
        <Crosshair aria-hidden="true" className="size-4 shrink-0" />
        {t(canLocate ? "plans.progress.locate" : "plans.progress.nodeMissing")}
      </Button>
    </section>
  );
}

/**
 * The newest report of any node of the run, from the same sources as the terminal.
 * @remarks
 * Antigravity sends no structured ACP plan; its progress calls and its own
 * list are its only reports, so they count here as well.
 */
function lastActivityAt(run: AgentPlanRun): string | null {
  const reported = allPlanRunResults(run)
    .map((step) => stepReportedAt(step))
    .filter((time): time is string => time !== null);
  reported.sort((first, second) => Date.parse(first) - Date.parse(second));
  return reported.at(-1) ?? null;
}

function PlanStatusNow({
  run,
  sequence,
  workspaceWait,
}: {
  readonly run: AgentPlanRun | null;
  readonly sequence: PlanStepSequence;
  readonly workspaceWait: PlanWorkspaceWait | null | undefined;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { formatDateTime } = useRegionFormatter();
  if (!run || workspaceWait) return null;
  if (run.status !== "running" && run.status !== "pausing") return null;
  const block = sequence.blocks.find(
    (entry) => entry.key === sequence.anchorKey,
  );
  const step =
    block?.kind === "actual" ? block.name : t("plans.progress.now.noStep");
  const activityAt = lastActivityAt(run);
  const pass =
    block && showsPass(block, sequence.blocks)
      ? ` · ${t("plans.progress.pass", { pass: block.pass })}`
      : "";
  return (
    <p
      role="status"
      className="border-t border-border bg-muted/50 px-3 py-2 text-xs wrap-anywhere text-muted-foreground"
    >
      {t("plans.progress.now.line", {
        step: `${step}${pass}`,
        completed: sequence.completed,
        activity: activityAt
          ? formatDateTime(activityAt)
          : t("plans.progress.notReported"),
      })}
    </p>
  );
}
