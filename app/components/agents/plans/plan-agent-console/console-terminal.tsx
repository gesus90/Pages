import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ConsoleStatusLine } from "./console-status-line";
import { formatMinuteTime, formatSecondTime } from "./console-time";
import { ConsoleTerminalInput } from "./console-terminal-input";
import { currentEnding, earlierAttempts } from "./console-step-state";
import { renderTerminal, runningTerminalTool } from "./terminal-lines";
import { useTerminalSurface } from "./use-terminal-surface";
import { useTerminalHistory } from "./use-terminal-history";
import { useTerminalColumns, useTerminalText } from "./use-terminal-text";

import type { TFunction } from "i18next";
import type { TerminalSurface } from "@/app/components/agents/workspaces/remote/console/terminal-surface";
import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type {
  AgentSessionEvent,
  AgentSessionKey,
} from "@/definition/AgentSessionJournal";
import type {
  TerminalAttempt,
  TerminalHistoryNote,
  TerminalInput,
  TerminalRows,
  TerminalTexts,
} from "./terminal-lines";
import type { AgentSessionData } from "./use-agent-session";
import type { SessionCommands } from "./use-session-commands";
import type { TerminalHistory } from "./use-terminal-history";

/** What the bottom of the terminal offers. */
export type TerminalInputMode = "line" | "ended" | "none";

interface ConsoleTerminalProps {
  readonly sessionKey: AgentSessionKey;
  readonly step: AgentPlanStepResult;
  readonly session: AgentSessionData;
  readonly commands: SessionCommands;
  readonly provider: string;
  readonly model: string;
  /** The instruction of the node, as the plan prompt of the first attempt. */
  readonly prompt: string | null;
  /** Names the session of a swarm, such as `H1`, in the start line and the closing line. */
  readonly sessionLabel?: string;
  readonly inputMode: TerminalInputMode;
  readonly canInterrupt: boolean;
  readonly onCloseRequest: () => void;
}

function joined(
  older: readonly AgentSessionEvent[],
  live: readonly AgentSessionEvent[],
): readonly AgentSessionEvent[] {
  const unique = new Map(older.map((event) => [event.sequence, event]));
  for (const event of live) unique.set(event.sequence, event);
  return [...unique.values()].sort(
    (left, right) => left.sequence - right.sequence,
  );
}

/** The attempts of the node in order, the current one last. */
function terminalAttempts(
  props: Pick<ConsoleTerminalProps, "sessionKey" | "step" | "session">,
  history: TerminalHistory,
): readonly TerminalAttempt[] {
  const earlier = earlierAttempts(props.step, props.sessionKey.attemptId);
  const index = (props.step.session?.retry?.attempts ?? []).findIndex(
    (attempt) => attempt.attemptId === props.sessionKey.attemptId,
  );
  const events = joined(history.older, props.session.events);
  return [
    ...earlier.map((attempt) => {
      const attemptEvents = history.earlier.get(attempt.attemptId) ?? [];
      return {
        number: attempt.number,
        startedAt: attemptEvents[0]?.createdAt ?? null,
        events: attemptEvents,
        ending: attempt.ending,
      };
    }),
    {
      number: index >= 0 ? index + 1 : earlier.length + 1,
      startedAt: props.step.session?.startedAt ?? null,
      events,
      ending: currentEnding(props.step),
      historyNote: currentHistoryNote(props.session, history, events),
    },
  ];
}

/** Marks the current attempt's history as limited or missing, never as complete when it is not. */
function currentHistoryNote(
  session: AgentSessionData,
  history: TerminalHistory,
  events: readonly AgentSessionEvent[],
): TerminalHistoryNote | null {
  if (session.source === "legacy_record") return "legacy";
  if (session.retainedFrom !== null && !history.hasOlder) return "retained";
  if (events.length === 0 && session.view?.state === "ended") return "missing";
  return null;
}

/** Reads older history once the reader reaches the top, by scrolling or by the wheel at the top. */
function useLoadOlderAtTop(
  surface: TerminalSurface | null,
  container: React.RefObject<HTMLDivElement | null>,
  history: TerminalHistory,
): void {
  const { hasOlder, loadOlder } = history;
  useEffect(() => {
    if (!surface || !hasOlder) return undefined;
    const scroll = surface.terminal.onScroll((line) => {
      if (line === 0) loadOlder();
    });
    const element = container.current;
    function handleWheel(event: WheelEvent): void {
      if (event.deltaY < 0 && surface?.terminal.buffer.active.viewportY === 0)
        loadOlder();
    }
    element?.addEventListener("wheel", handleWheel, { passive: true });
    return () => {
      scroll.dispose();
      element?.removeEventListener("wheel", handleWheel);
    };
  }, [surface, container, hasOlder, loadOlder]);
}

function TerminalFooter(props: {
  readonly inputMode: TerminalInputMode;
  readonly commands: SessionCommands;
  readonly canInterrupt: boolean;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (props.inputMode === "line")
    return (
      <ConsoleTerminalInput
        commands={props.commands}
        canInterrupt={props.canInterrupt}
      />
    );
  if (props.inputMode === "ended")
    return (
      <p className="px-[22px] pt-2 pb-3 font-mono text-xs text-agent-terminal-muted">
        {t("plans.console.terminal.ended")}
      </p>
    );
  return null;
}

/**
 * The Pages terminal of an agent node: the stored ACP history of all its
 * attempts in one xterm, the same for every provider.
 * @remarks
 * It is no PTY and no surface of a CLI. The lines come from
 * {@link renderTerminal}; the newest events arrive live, older ones load
 * when the reader scrolls up. Closing the console ends only the view.
 */
export function ConsoleTerminal(
  props: ConsoleTerminalProps,
): React.ReactElement {
  const { t, i18n } = useTranslation();
  const container = useRef<HTMLDivElement | null>(null);
  const { expandedCalls, toggle } = useExpandedCalls();
  const { onCloseRequest } = props;
  // The terminal is created once; it calls the newest close handler.
  const latestClose = useRef(onCloseRequest);
  useEffect(() => {
    latestClose.current = onCloseRequest;
  }, [onCloseRequest]);
  const closeRequest = useCallback(() => latestClose.current(), []);
  const surface = useTerminalSurface(container, closeRequest);
  const columns = useTerminalColumns(surface);
  const history = useTerminalHistory(props.sessionKey, {
    firstSequence: props.session.events[0]?.sequence ?? null,
    hasEarlier: props.session.hasEarlier,
    earlier: earlierAttempts(props.step, props.sessionKey.attemptId),
  });
  const todoTexts = new Map(
    (props.step.session?.contract?.todos ?? []).map((todo) => [
      todo.id,
      todo.text,
    ]),
  );
  const input: TerminalInput = {
    provider: props.provider,
    model: props.model,
    prompt: props.prompt,
    attempts: terminalAttempts(props, history),
    todoTexts,
    columns,
    texts: terminalTexts(t, i18n.language, props.sessionLabel),
    expandedCalls,
    sessionLabel: props.sessionLabel,
  };
  const rows = renderTerminal(input);
  useTerminalText(columns === null ? null : surface, rows);
  useToolToggleLinks(surface, rows, toggle);
  useLoadOlderAtTop(surface, container, history);
  const retry = props.step.session?.retry;
  return (
    <section
      aria-label={t("plans.console.terminal.title")}
      className="flex min-h-[24rem] min-w-0 flex-1 flex-col bg-agent-terminal-surface min-[680px]:min-h-0"
    >
      <div className="min-h-0 flex-1 px-[22px] pt-[18px] pb-2">
        <div
          ref={container}
          data-testid="plan-terminal"
          className="h-full w-full"
        />
      </div>
      {props.inputMode === "ended" ? null : (
        <ConsoleStatusLine
          tool={runningTerminalTool(input)}
          resumeAt={retry?.state === "waiting" ? retry.nextAttemptAt : null}
        />
      )}
      <TerminalFooter
        inputMode={props.inputMode}
        commands={props.commands}
        canInterrupt={props.canInterrupt}
      />
    </section>
  );
}

interface ToolToggles {
  readonly expandedCalls: ReadonlySet<string>;
  readonly toggle: (callId: string) => void;
}

function useExpandedCalls(): ToolToggles {
  const [expandedCalls, setExpandedCalls] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  function toggle(callId: string): void {
    setExpandedCalls((current) => {
      const next = new Set(current);
      if (next.has(callId)) next.delete(callId);
      else next.add(callId);
      return next;
    });
  }
  return { expandedCalls, toggle };
}

function useToolToggleLinks(
  surface: TerminalSurface | null,
  rows: TerminalRows,
  toggle: (callId: string) => void,
): void {
  const latest = useRef({ rows, toggle });
  useEffect(() => {
    latest.current = { rows, toggle };
  }, [rows, toggle]);
  useEffect(() => {
    if (!surface) return undefined;
    const { terminal } = surface;
    const provider = terminal.registerLinkProvider({
      provideLinks(bufferLine, callback) {
        const current = latest.current;
        const dropped = Math.max(
          0,
          current.rows.rows.length - terminal.buffer.active.length,
        );
        const row = bufferLine - 1 + dropped;
        const links = current.rows.toggles
          .filter((entry) => entry.row === row)
          .map((entry) => ({
            range: {
              start: { x: entry.startColumn, y: bufferLine },
              end: { x: entry.endColumn, y: bufferLine },
            },
            text: entry.callId,
            decorations: { pointerCursor: true, underline: true },
            activate: () => latest.current.toggle(entry.callId),
          }));
        callback(links.length > 0 ? links : undefined);
      },
    });
    return () => provider.dispose();
  }, [surface]);
}

const TOOL_KINDS: ReadonlySet<string> = new Set([
  "read",
  "edit",
  "delete",
  "move",
  "search",
  "execute",
  "fetch",
]);

function failureText(t: TFunction, code: string): string {
  return t([`settings.agents.error.${code}`, code]);
}

/**
 * The translated words of the terminal, also for the miniature of a session.
 * @param t - The translation function.
 * @param language - The app language, for numbers and times.
 * @param sessionLabel - The name of a swarm session; its closing line then names it.
 */
export function terminalTexts(
  t: TFunction,
  language: string,
  sessionLabel?: string,
): TerminalTexts {
  const key = "plans.console.terminal";
  const secondsFormat = new Intl.NumberFormat(language, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const session = (isSameSession: boolean): string =>
    t(`${key}.${isSameSession ? "sameSession" : "newSession"}`);
  return {
    attempt: (number) => t(`${key}.attempt`, { number }),
    minute: (at) => formatMinuteTime(at, language),
    clock: (at) => formatSecondTime(at, language),
    toolKind: (kind) =>
      TOOL_KINDS.has(kind) ? t(`${key}.toolKind.${kind}`) : null,
    done: t(`${key}.done`),
    aborted: t(`${key}.aborted`),
    running: t(`${key}.toolRunning`),
    exitCode: (code) => t(`${key}.toolExit`, { code }),
    lineCount: (count) => t(`${key}.toolLines`, { count }),
    duration: (milliseconds) =>
      t(`${key}.toolDuration`, {
        seconds: secondsFormat.format(milliseconds / 1000),
      }),
    showOutput: t(`${key}.toolShowOutput`),
    hideOutput: t(`${key}.toolHideOutput`),
    showJson: (lines) => t(`${key}.toolShowJson`, { count: lines }),
    hideJson: t(`${key}.toolHideJson`),
    outputLimited: t(`${key}.toolOutputLimited`),
    history: (note) => t(`${key}.history.${note}`),
    todo: (id, text) => t(`${key}.todo`, { id, text }),
    turnEnded: t(`${key}.turnEnded`),
    interrupted: t(`${key}.interrupted`),
    reportReceived: (done, total) =>
      t(`${key}.reportReceived`, { done, total }),
    sessionClosed: t(`${key}.sessionClosed`),
    swarmClosed:
      sessionLabel === undefined
        ? null
        : t(`${key}.swarmClosed`, { name: sessionLabel }),
    abort: (reason) => t(`${key}.abort`, { reason: failureText(t, reason) }),
    noReport: t(`${key}.noReport`),
    resume: (seconds, restart, limit, isSameSession) =>
      t(`${key}.resume`, {
        seconds,
        restart,
        limit,
        session: session(isSameSession),
      }),
    repair: (restart, limit, isSameSession) =>
      t(`${key}.repair`, { restart, limit, session: session(isSameSession) }),
    blocked: (reason, attempts) =>
      t(`${key}.blocked`, { reason: failureText(t, reason), attempts }),
    stopped: t(`${key}.stopped`),
  };
}
