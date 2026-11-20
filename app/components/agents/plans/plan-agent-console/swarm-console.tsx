import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  planSwarmConfiguredEntries,
  planSwarmSessionEntries,
} from "@/definition/AgentPlanSwarmSession";
import { sessionAttemptId } from "@/definition/AgentSessionJournal";

import { planLoopMemberResult } from "../plan-loop-summary";
import { SessionBodyLayout, ConsoleSession } from "./console-session";
import { NoteBadge } from "./console-header-badges";
import { isRunActive, sessionKeyText } from "./console-target";
import { Fact, SidebarSection } from "./console-sidebar-parts";
import { terminalTexts } from "./console-terminal";
import { lastPreviewLine, previewRows } from "./swarm-session-preview";
import { SwarmSessionBar, SwarmSessionColumn } from "./swarm-session-list";
import { useSwarmPreviews } from "./use-swarm-previews";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanSwarm } from "@/definition/AgentPlanSwarm";
import type { PlanSwarmSessionEntry } from "@/definition/AgentPlanSwarmSession";
import type { AgentSessionKey } from "@/definition/AgentSessionJournal";
import type { ConsoleSwarmSlot } from "./console-session";
import type { ConsoleHeaderRenderer } from "./console-header";
import type { SwarmCardData, SwarmListMemory } from "./swarm-session-list";
import type { SwarmPreview, SwarmPreviewTarget } from "./use-swarm-previews";

interface SwarmConsoleProps {
  readonly swarm: AgentPlanSwarm;
  readonly run: AgentPlanRun | null;
  readonly isReadOnly: boolean;
  readonly onClose: () => void;
  readonly header: ConsoleHeaderRenderer;
}

/** Whether the session can still take a turn. */
function isSessionOpen(entry: PlanSwarmSessionEntry): boolean {
  return entry.status === "running" || entry.status === "waiting";
}

function sessionKeyOf(
  run: AgentPlanRun | null,
  entry: PlanSwarmSessionEntry,
): AgentSessionKey | null {
  const { session } = entry.step;
  if (!run || !session) return null;
  return {
    planId: run.planId,
    runId: run.id,
    stepId: entry.stepId,
    attemptId: sessionAttemptId(session, entry.stepId),
  };
}

function previewTarget(
  run: AgentPlanRun | null,
  entry: PlanSwarmSessionEntry,
  isNodeActive: boolean,
): SwarmPreviewTarget {
  const endedAt = Date.parse(entry.step.session?.endedAt ?? "");
  return {
    stepId: entry.stepId,
    key: sessionKeyOf(run, entry),
    isActive: isNodeActive && isSessionOpen(entry),
    endedAt: Number.isFinite(endedAt) ? endedAt : null,
  };
}

/** The card of a session: its name, state and the miniature of what it wrote. */
function cardOf(
  entry: PlanSwarmSessionEntry,
  facts: {
    readonly name: string;
    readonly rows: readonly string[];
    readonly preview: SwarmPreview | undefined;
    readonly isNodeActive: boolean;
  },
): SwarmCardData {
  return {
    stepId: entry.stepId,
    name: facts.name,
    status: entry.status,
    model: entry.model,
    hasSession: entry.step.session !== null && entry.step.session !== undefined,
    isLive: facts.isNodeActive && isSessionOpen(entry),
    rows: facts.rows,
    lastLine: lastPreviewLine(facts.rows),
    readAt: facts.preview?.readAt ?? null,
  };
}

/** How many helpers finished of all helpers. */
function helperCount(entries: readonly PlanSwarmSessionEntry[]): {
  readonly done: number;
  readonly total: number;
} {
  const helpers = entries.filter((entry) => entry.role === "worker");
  return {
    done: helpers.filter((entry) => entry.status === "succeeded").length,
    total: helpers.length,
  };
}

/** The details of a session that has no history: only what the swarm knows about it. */
function UnstartedDetails(props: {
  readonly entry: PlanSwarmSessionEntry;
  readonly roleLabel: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const key = "plans.console.terminal.sidebar";
  const unknown = t(`${key}.unknown`);
  return (
    <aside
      aria-label={t("plans.console.details")}
      className="flex min-w-0 shrink-0 flex-col overflow-y-auto border-t border-agent-console-border bg-agent-console-surface px-5 pt-5 pb-8 min-[680px]:w-[300px] min-[680px]:border-t-0 min-[680px]:border-l"
    >
      <SidebarSection title={t(`${key}.session`)}>
        <dl className="mt-1">
          <Fact label={t(`${key}.role`)} value={props.roleLabel} />
          <Fact
            label={t(`${key}.model`)}
            value={props.entry.model || unknown}
          />
        </dl>
      </SidebarSection>
    </aside>
  );
}

/** The terminal area of a session that did not start or wrote nothing: the reason, never an empty area. */
function UnstartedMessage(props: {
  readonly entry: PlanSwarmSessionEntry;
}): React.ReactElement {
  const { t } = useTranslation();
  const { entry } = props;
  const key = entry.status === "waiting" ? "notStarted" : "noOutput";
  return (
    <div
      role="status"
      className="min-h-[24rem] flex-1 bg-agent-terminal-surface px-[22px] py-[18px] font-mono text-[13px] text-agent-terminal-muted min-[680px]:min-h-0"
    >
      <p>{t(`plans.console.swarm.${key}`)}</p>
      {entry.reason ? (
        <p className="mt-1">
          {t([`settings.agents.error.${entry.reason}`, entry.reason])}
        </p>
      ) : null}
    </div>
  );
}

function SwarmUnstarted(props: {
  readonly entry: PlanSwarmSessionEntry;
  readonly slot: ConsoleSwarmSlot;
  readonly header: ConsoleHeaderRenderer;
}): React.ReactElement {
  const { t } = useTranslation();
  const { entry, slot } = props;
  const label = slot.isEnded
    ? t("plans.console.state.ended")
    : t(`plans.console.swarm.status.${entry.status}`);
  return (
    <>
      {props.header(null, { label, tone: "neutral" }, undefined, slot.badges)}
      <SessionBodyLayout
        swarm={slot}
        sidebar={<UnstartedDetails entry={entry} roleLabel={slot.roleLabel} />}
      >
        <UnstartedMessage entry={entry} />
      </SessionBodyLayout>
    </>
  );
}

/** The state of the swarm and its pickers in one slot for the session in view. */
function useSwarmSlot(input: {
  readonly entries: readonly PlanSwarmSessionEntry[];
  readonly selected: PlanSwarmSessionEntry;
  readonly cards: readonly SwarmCardData[];
  readonly isEnded: boolean;
  readonly onSelect: (stepId: string) => void;
}): ConsoleSwarmSlot {
  const { t } = useTranslation();
  const memory = useRef<SwarmListMemory>({
    scroll: { column: 0, bar: 0 },
    restoreFocus: null,
  });
  const { selected } = input;
  const picker = {
    cards: input.cards,
    selectedId: selected.stepId,
    memory,
    onSelect: input.onSelect,
  };
  const count = helperCount(input.entries);
  return {
    roleLabel:
      selected.workerId === null
        ? t("plans.console.swarm.roleMain")
        : t("plans.console.swarm.roleHelper", {
            number: selected.workerId.slice(1),
          }),
    sessionLabel: selected.workerId ?? t("plans.console.swarm.main"),
    isEnded: input.isEnded,
    badges:
      count.total > 0 ? (
        <NoteBadge>{t("plans.console.swarm.helpers", count)}</NoteBadge>
      ) : null,
    bar: <SwarmSessionBar {...picker} />,
    column: <SwarmSessionColumn {...picker} />,
  };
}

/** Whether the swarm still works: its node runs in a run that can change. */
function isSwarmActive(
  run: AgentPlanRun | null,
  node: AgentPlanStepResult | null,
): boolean {
  return run !== null && node?.status === "running" && isRunActive(run);
}

/** Whether the swarm is over; a node that did not run yet ends with its run, and without a run it waits. */
function isSwarmEnded(
  run: AgentPlanRun | null,
  node: AgentPlanStepResult | null,
): boolean {
  if (node) return !isSwarmActive(run, node);
  return run !== null && !isRunActive(run);
}

function SwarmSessions(props: {
  readonly node: AgentPlanStepResult | null;
  readonly entries: readonly PlanSwarmSessionEntry[];
  readonly main: PlanSwarmSessionEntry;
  readonly run: AgentPlanRun | null;
  readonly isReadOnly: boolean;
  readonly onClose: () => void;
  readonly header: ConsoleHeaderRenderer;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const { run, node, entries } = props;
  const [pickedId, setPickedId] = useState(props.main.stepId);
  const selected =
    entries.find((entry) => entry.stepId === pickedId) ?? props.main;
  const isNodeActive = isSwarmActive(run, node);
  const previews = useSwarmPreviews(
    entries.map((entry) => previewTarget(run, entry, isNodeActive)),
    selected.stepId,
  );
  const cards = useMemo(() => {
    const texts = terminalTexts(t, i18n.language);
    return entries.map((entry) => {
      const preview = previews.get(entry.stepId);
      return cardOf(entry, {
        name: entry.workerId ?? t("plans.console.swarm.main"),
        rows: preview ? previewRows(preview.events, texts) : [],
        preview,
        isNodeActive,
      });
    });
  }, [entries, previews, isNodeActive, t, i18n.language]);
  const slot = useSwarmSlot({
    entries,
    selected,
    cards,
    isEnded: isSwarmEnded(run, node),
    onSelect: setPickedId,
  });
  const key = sessionKeyOf(run, selected);
  if (!key || !selected.step.session)
    return (
      <SwarmUnstarted entry={selected} slot={slot} header={props.header} />
    );
  return (
    <ConsoleSession
      key={sessionKeyText(key)}
      sessionKey={key}
      step={selected.step}
      isLive={isNodeActive && isSessionOpen(selected)}
      isReadOnly={props.isReadOnly}
      prompt={null}
      onClose={props.onClose}
      header={props.header}
      swarm={slot}
    />
  );
}

/**
 * The console of a swarm node: the main model and every helper as a session.
 *
 * @remarks
 * The terminal on the left and the details on the right show the selected
 * session; the sessions stand between them as a column of 232 px, or above
 * the terminal as a bar on narrow windows. The main model is selected first.
 * A helper that did not start is listed too, with what is known of it; a node
 * that did not run yet lists the sessions its plan configures.
 */
export function SwarmConsole(props: SwarmConsoleProps): React.ReactElement {
  const { run, swarm } = props;
  const node = run
    ? (run.steps.find((step) => step.id === swarm.id) ??
      planLoopMemberResult(run, swarm.id) ??
      null)
    : null;
  const entries = useMemo(() => {
    const stored = node ? planSwarmSessionEntries(node) : [];
    return stored.length > 0 ? stored : planSwarmConfiguredEntries(swarm);
  }, [node, swarm]);
  const [main] = entries;
  if (!main) return <>{props.header(null, null)}</>;
  return (
    <SwarmSessions
      node={node}
      entries={entries}
      main={main}
      run={run}
      isReadOnly={props.isReadOnly}
      onClose={props.onClose}
      header={props.header}
    />
  );
}
