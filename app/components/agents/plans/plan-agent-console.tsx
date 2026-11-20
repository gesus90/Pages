import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useHidePicaLauncher } from "@/app/components/chat/use-pica-launcher-visibility";
import { ForegroundPanel } from "@/app/components/ui/foreground-panel";
import { ScrollViewport } from "@/app/components/ui/scroll-viewport";

import { ConsoleHeader } from "./plan-agent-console/console-header";
import { ConsoleSession } from "./plan-agent-console/console-session";
import { SwarmConsole } from "./plan-agent-console/swarm-console";
import {
  consoleSession,
  findConsoleNode,
  isRunActive,
  sessionKeyText,
} from "./plan-agent-console/console-target";
import { planNodeLabel } from "./plan-layout";
import { PlanStatusBadge } from "./plan-status";

import type {
  AgentPlanInput,
  AgentPlanRun,
  AgentPlanSources,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { ConsoleHeaderRenderer } from "./plan-agent-console/console-header";
import type { ConsoleNode } from "./plan-agent-console/console-target";
import type { usePlanRun } from "./use-plan-run";

interface PlanAgentConsoleProps {
  readonly nodeId: string;
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly running: ReturnType<typeof usePlanRun>;
  readonly onClose: () => void;
}

/** The agent step whose session the console shows: the node itself or the member a group asked for. */
function consoleMember(
  opened: ConsoleNode,
  memberId: string | null,
): AgentPlanStep | undefined {
  if (opened.kind === "agent") return opened.step;
  if (opened.kind === "group")
    return opened.group.steps.find((step) => step.id === memberId);
  return undefined;
}

/** Changes whenever the console draws another header: another member, run or session state. */
function consoleFocusKey(
  opened: ConsoleNode | null,
  memberId: string | null,
  run: AgentPlanRun | null,
): string {
  // The selection inside a swarm never draws another header heading.
  const stepId =
    opened?.kind === "agent" || opened?.kind === "swarm"
      ? consoleNodeId(opened)
      : (memberId ?? "");
  return [stepId, run?.id ?? "", consoleSession(run, stepId).kind].join("/");
}

function consoleNodeId(opened: ConsoleNode): string {
  if (opened.kind === "agent") return opened.step.id;
  if (opened.kind === "swarm") return opened.swarm.id;
  return opened.group.id;
}

function consoleTitle(
  opened: ConsoleNode,
  sources: AgentPlanSources,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (opened.kind === "group") return opened.group.name;
  if (opened.kind === "swarm")
    return opened.swarm.name ?? t("plans.nodeType.swarm");
  return planNodeLabel(opened.step, sources) || t("plans.missingAgent");
}

/**
 * Escape closes the console like a ticket panel, unless a field inside
 * handled it, an IME composes or the terminal has the focus: in the input
 * line of the Pages terminal Escape interrupts the running step.
 */
function useEscapeToClose(onClose: () => void): void {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      const isTerminal =
        event.target instanceof Element &&
        event.target.closest(".xterm") !== null;
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !event.isComposing &&
        !isTerminal
      )
        onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);
}

/** The first line of the node's instruction, the plan prompt of the terminal. */
function promptLine(step: AgentPlanStep): string | null {
  const line = step.instruction
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry !== "");
  return line ?? null;
}

function AgentConsole(props: {
  readonly step: AgentPlanStep;
  readonly run: AgentPlanRun | null;
  readonly isReadOnly: boolean;
  readonly onClose: () => void;
  readonly header: ConsoleHeaderRenderer;
}): React.ReactElement {
  const { t } = useTranslation();
  const session = consoleSession(props.run, props.step.id);
  if (session.kind !== "session" || !props.run)
    return (
      <>
        {props.header(null, null)}
        <p className="px-5 py-6 text-sm text-muted-foreground">
          {t(
            `plans.console.empty.${session.kind === "session" ? "no_run" : session.kind}`,
          )}
        </p>
      </>
    );
  return (
    <ConsoleSession
      key={sessionKeyText(session.key)}
      sessionKey={session.key}
      step={session.step}
      isLive={isRunActive(props.run)}
      isReadOnly={props.isReadOnly}
      prompt={promptLine(props.step)}
      onClose={props.onClose}
      header={props.header}
    />
  );
}

interface ConsoleHeaderFacts {
  readonly title: string;
  readonly nodeType: string;
  readonly running: ReturnType<typeof usePlanRun>;
  readonly headingRef: React.RefObject<HTMLHeadingElement | null>;
  readonly onClose: () => void;
  readonly onBack: (() => void) | undefined;
}

/** The header the console draws above every session of the node. */
function consoleHeader(facts: ConsoleHeaderFacts): ConsoleHeaderRenderer {
  const { running } = facts;
  return (provider, state, onStopRun, badges) => (
    <ConsoleHeader
      title={facts.title}
      nodeType={facts.nodeType}
      runs={running.runs}
      run={running.run}
      provider={provider}
      state={state}
      headingRef={facts.headingRef}
      onSelectRun={(id) => running.select(id, "history")}
      onClose={facts.onClose}
      onBack={facts.onBack}
      onStopRun={onStopRun}
      badges={badges}
    />
  );
}

/**
 * The PageAgentCLI console of an agent node in the fixed ticket panel over the plan.
 *
 * @remarks
 * Opening reads the node's session and starts no process; closing ends the
 * live stream only, never the session or the run, and leaves the canvas
 * where it was. A group asks for one of its agent steps instead of guessing
 * a session. Runs other than the newest active one read as history.
 */
export function PlanAgentConsole(
  props: PlanAgentConsoleProps,
): React.ReactElement | null {
  const { t } = useTranslation();
  const { running, onClose } = props;
  const [memberId, setMemberId] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const keyboardInset = useKeyboardInset();
  useEscapeToClose(onClose);
  // Pica's symbol would cover the lower right corner of the terminal.
  useHidePicaLauncher();
  const opened = findConsoleNode(props.draft, props.nodeId);
  const { run } = running;
  const focusKey = consoleFocusKey(opened, memberId, run);
  // A member, run or session switch draws a new header; its heading takes the focus again,
  // and an open instruction field takes it once it loaded.
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [focusKey]);
  if (!opened) return null;
  const group = opened.kind === "group" ? opened.group : null;
  const member = consoleMember(opened, memberId);
  const isReadOnly =
    run !== null &&
    (run.status !== "running" ||
      run.stopRequested ||
      running.runs[0]?.id !== run.id);
  const title = consoleTitle(opened, props.sources, t);
  const header = consoleHeader({
    title:
      group && member
        ? `${title} · ${planNodeLabel(member, props.sources)}`
        : title,
    nodeType: t(`plans.nodeType.${opened.kind}`),
    running,
    headingRef: heading,
    onClose,
    onBack: group && member ? () => setMemberId(null) : undefined,
  });
  return (
    <ForegroundPanel
      aria-label={t("plans.console.label", { name: title })}
      keyboardInset={keyboardInset}
      isFullscreen
      className="@container flex flex-col border border-agent-console-border bg-agent-console-surface text-agent-console-foreground"
    >
      {member ? (
        <AgentConsole
          step={member}
          run={run}
          isReadOnly={isReadOnly}
          onClose={onClose}
          header={header}
        />
      ) : null}
      {opened.kind === "swarm" ? (
        <SwarmConsole
          swarm={opened.swarm}
          run={run}
          isReadOnly={isReadOnly}
          onClose={onClose}
          header={header}
        />
      ) : null}
      {group && !member ? (
        <>
          {header(null, null)}
          <ConsoleGroup
            group={group}
            sources={props.sources}
            run={run}
            onPick={setMemberId}
          />
        </>
      ) : null}
    </ForegroundPanel>
  );
}

function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return undefined;
    const visible = viewport;
    function update(): void {
      setInset(
        Math.max(
          0,
          Math.round(window.innerHeight - visible.height - visible.offsetTop),
        ),
      );
    }
    update();
    visible.addEventListener("resize", update);
    visible.addEventListener("scroll", update);
    return () => {
      visible.removeEventListener("resize", update);
      visible.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
}

function ConsoleGroup({
  group,
  sources,
  run,
  onPick,
}: {
  readonly group: AgentPlanGroup;
  readonly sources: AgentPlanSources;
  readonly run: AgentPlanRun | null;
  readonly onPick: (stepId: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <ScrollViewport
      axis="vertical"
      containerClassName="min-h-0 flex-1"
      className="overflow-y-auto px-5 py-4"
    >
      <p className="mb-3 text-sm text-muted-foreground">
        {t("plans.console.pickMember")}
      </p>
      {group.steps.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("plans.console.noMembers")}
        </p>
      ) : (
        <ul className="space-y-2">
          {group.steps.map((step) => {
            const result = run?.steps.find((entry) => entry.id === step.id);
            const label =
              planNodeLabel(step, sources) || t("plans.missingAgent");
            return (
              <li key={step.id}>
                <button
                  type="button"
                  onClick={() => onPick(step.id)}
                  className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
                >
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  {result ? (
                    <PlanStatusBadge
                      compact
                      status={result.status}
                      isBlocked={result.isBlocked}
                    />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </ScrollViewport>
  );
}
