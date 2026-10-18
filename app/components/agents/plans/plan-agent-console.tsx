import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ForegroundPanel } from "@/app/components/ui/foreground-panel";

import { ConsoleGroup } from "./plan-agent-console/console-group";
import { ConsoleHeader } from "./plan-agent-console/console-header";
import { ConsoleSession } from "./plan-agent-console/console-session";
import { useKeyboardInset } from "./plan-agent-console/use-keyboard-inset";
import {
  consoleSession,
  findConsoleNode,
  isRunActive,
  sessionKeyText,
} from "./plan-agent-console/console-target";
import { planNodeLabel } from "./plan-layout";

import type {
  AgentPlanInput,
  AgentPlanRun,
  AgentPlanSources,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { AgentSessionState } from "@/definition/AgentSessionJournal";
import type { ConsoleNode } from "./plan-agent-console/console-target";
import type { usePlanRun } from "./use-plan-run";

interface PlanAgentConsoleProps {
  readonly nodeId: string;
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly running: ReturnType<typeof usePlanRun>;
  readonly onClose: () => void;
}

/** Changes whenever the console draws another header: another member, run or session state. */
function consoleFocusKey(
  opened: ConsoleNode | null,
  memberId: string | null,
  run: AgentPlanRun | null,
): string {
  const stepId = opened?.kind === "agent" ? opened.step.id : (memberId ?? "");
  return [stepId, run?.id ?? "", consoleSession(run, stepId).kind].join("/");
}

/** Escape closes the console like a ticket panel, unless a field inside handled it or an IME composes. */
function useEscapeToClose(onClose: () => void): void {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !event.isComposing
      )
        onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);
}

function AgentConsole(props: {
  readonly step: AgentPlanStep;
  readonly run: AgentPlanRun | null;
  readonly isReadOnly: boolean;
  readonly header: (
    provider: string | null,
    state: AgentSessionState | null,
  ) => React.ReactNode;
}): React.ReactElement {
  const { t } = useTranslation();
  const session = consoleSession(props.run, props.step.id);
  if (session.kind !== "session")
    return (
      <>
        {props.header(null, null)}
        <p className="px-5 py-6 text-sm text-muted-foreground">
          {t(`plans.console.empty.${session.kind}`)}
        </p>
      </>
    );
  const provider = session.step.session?.runner ?? null;
  return (
    <ConsoleSession
      key={sessionKeyText(session.key)}
      sessionKey={session.key}
      step={session.step}
      isLive={props.run !== null && isRunActive(props.run)}
      isReadOnly={props.isReadOnly}
      header={(state) => props.header(provider, state)}
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
  const member =
    opened.kind === "group"
      ? opened.group.steps.find((step) => step.id === memberId)
      : opened.step;
  const isReadOnly =
    run !== null &&
    (run.status !== "running" ||
      run.stopRequested ||
      running.runs[0]?.id !== run.id);
  const title =
    opened.kind === "group"
      ? opened.group.name
      : planNodeLabel(opened.step, props.sources) || t("plans.missingAgent");
  function header(
    provider: string | null,
    state: AgentSessionState | null,
  ): React.ReactNode {
    return (
      <ConsoleHeader
        title={
          group && member
            ? `${title} · ${planNodeLabel(member, props.sources)}`
            : title
        }
        nodeType={t(`plans.nodeType.${group ? "group" : "agent"}`)}
        runs={running.runs}
        run={run}
        provider={provider}
        state={state}
        isReadOnly={isReadOnly}
        headingRef={heading}
        onSelectRun={running.select}
        onClose={onClose}
        onBack={group && member ? () => setMemberId(null) : undefined}
      />
    );
  }
  return (
    <ForegroundPanel
      aria-label={t("plans.console.label", { name: title })}
      keyboardInset={keyboardInset}
    >
      {member ? (
        <AgentConsole
          step={member}
          run={run}
          isReadOnly={isReadOnly}
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
