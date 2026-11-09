import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ScrollViewport } from "@/app/components/ui/scroll-viewport";

import { ConsoleComposer } from "./console-composer";
import { ConsoleControls } from "./console-controls";
import { ConsoleFailure } from "./console-failure";
import { ConsoleHistory } from "./console-history";
import { ConsoleMetadata } from "./console-metadata";
import { ConsoleTerminal } from "./console-terminal";
import { formatDuration, formatLocalTime } from "./console-time";
import { ConsoleUsage } from "./console-usage";
import { useAgentSession } from "./use-agent-session";
import { useSessionCommands } from "./use-session-commands";
import { PlanRemoteHistoryNotice } from "../plan-remote-history";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type {
  AgentSessionKey,
  AgentSessionState,
  AgentSessionView,
} from "@/definition/AgentSessionJournal";
import type { AgentTerminalState } from "@/definition/AgentTerminal";
import type { SessionCommands } from "./use-session-commands";

interface ConsoleSessionProps {
  readonly sessionKey: AgentSessionKey;
  readonly step: AgentPlanStepResult;
  readonly isLive: boolean;
  readonly isReadOnly: boolean;
  /** The CLI of the node runs in a terminal; otherwise the session shows its ACP history. */
  readonly isTerminal: boolean;
  /** Names a node of the plan, for the active member of a shared terminal. */
  readonly nodeName: (stepId: string) => string;
  readonly onClose: () => void;
  /** Draws the header with what the session reported and the stop of the run. */
  readonly header: (
    state: AgentSessionState | null,
    onStopRun: (() => Promise<void>) | undefined,
  ) => React.ReactNode;
}

/** The newest time something happened: output of the terminal, an event or the record. */
function sessionActivity(
  terminal: AgentTerminalState | null,
  session: ReturnType<typeof useAgentSession>,
  step: AgentPlanStepResult,
): string | null {
  const values = [
    terminal?.lastActivityAt,
    session.events.at(-1)?.createdAt,
    step.session?.turnEndedAt,
    step.session?.startedAt,
  ];
  return formatLocalTime(values.find((value) => value) ?? null);
}

function runtime(step: AgentPlanStepResult): string | null {
  const started = step.session?.startedAt;
  if (!started) return null;
  const ended = step.session?.endedAt ?? step.session?.turnEndedAt;
  const end =
    step.status === "running" || !ended ? Date.now() : Date.parse(ended);
  return formatDuration(end - Date.parse(started));
}

function remoteSessionView(
  view: AgentSessionView | null,
  step: AgentPlanStepResult,
): AgentSessionView | null {
  if (
    !view ||
    step.execution?.target.kind !== "remote" ||
    step.status !== "running" ||
    view.continuation.mode !== "unavailable"
  )
    return view;
  return {
    ...view,
    continuation: { ...view.continuation, reason: "remote_one_shot" },
  };
}

/** The status the facts beside a terminal show: the terminal's own once it reported one. */
function terminalStatus(
  terminal: AgentTerminalState | null,
  view: AgentSessionView,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (terminal?.status === "ended") return t("plans.console.terminal.ended");
  return t(`plans.console.state.${view.state}`);
}

/** The facts of the session in the fixed column beside the terminal or history. */
function SessionFacts(props: {
  readonly view: AgentSessionView;
  readonly step: AgentPlanStepResult;
  readonly terminal: AgentTerminalState | null;
  readonly isTerminal: boolean;
  readonly isReadOnly: boolean;
  readonly commands: SessionCommands;
  readonly activity: string | null;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const record = props.step.session;
  if (!record) return null;
  return (
    <ScrollViewport
      as="aside"
      axis="vertical"
      aria-label={t("plans.console.details")}
      containerClassName={
        // Beside a terminal the facts follow it on small screens, so the terminal keeps its height.
        props.isTerminal
          ? "shrink-0 lg:w-[340px]"
          : "order-first max-h-[35%] shrink-0 lg:order-none lg:max-h-none lg:w-[340px]"
      }
      className="space-y-5 overflow-y-auto border-b border-border px-5 py-4 lg:border-b-0 lg:border-l"
    >
      <ConsoleMetadata
        view={props.view}
        record={record}
        status={terminalStatus(props.terminal, props.view, t)}
        runtime={runtime(props.step)}
        lastActivity={props.activity}
      />
      <ConsoleUsage view={props.view} />
      {props.isTerminal ? null : (
        <ConsoleControls
          view={props.view}
          isReadOnly={props.isReadOnly}
          commands={props.commands}
        />
      )}
    </ScrollViewport>
  );
}

/** The history and instruction field of an ACP session, such as Antigravity's. */
function AcpColumn(props: {
  readonly session: ReturnType<typeof useAgentSession>;
  readonly view: AgentSessionView;
  readonly step: AgentPlanStepResult;
  readonly isReadOnly: boolean;
  readonly commands: SessionCommands;
}): React.ReactElement {
  const { t } = useTranslation();
  const { session, step } = props;
  const error = session.error
    ? ` · ${t([`settings.agents.error.${session.error}`, "settings.agents.error.general"])}`
    : "";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p role="status" className="px-5 pt-2 text-xs text-muted-foreground">
        {t(`plans.console.connection.${session.connection}`)}
        {error}
      </p>
      <ConsoleFailure remote={step.remote} />
      <ConsoleHistory
        events={session.events}
        source={session.source}
        retainedFrom={session.retainedFrom}
        navigation={session}
      />
      <PlanRemoteHistoryNotice step={step} />
      <ConsoleComposer
        view={props.view}
        isReadOnly={props.isReadOnly}
        commands={props.commands}
      />
    </div>
  );
}

/** Says that the session loads, or why it could not be read. */
function SessionNotice({
  session,
  hasView,
}: {
  readonly session: ReturnType<typeof useAgentSession>;
  readonly hasView: boolean;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (session.error && !hasView)
    return (
      <p role="alert" className="px-5 py-4 text-sm text-destructive">
        {t([
          `settings.agents.error.${session.error}`,
          "settings.agents.error.general",
        ])}
      </p>
    );
  if (session.connection !== "loading") return null;
  return (
    <p role="status" className="px-5 py-4 text-sm text-muted-foreground">
      {t("plans.console.loading")}
    </p>
  );
}

/**
 * The session of one node attempt: the terminal of its CLI, or the history
 * and input of an ACP session, on the left, the facts on the right.
 *
 * @remarks
 * The caller mounts it once per session key, so a node or run switch starts
 * from empty data and late answers of the previous session are dropped.
 */
export function ConsoleSession(props: ConsoleSessionProps): React.ReactElement {
  const { step } = props;
  const [terminal, setTerminal] = useState<AgentTerminalState | null>(null);
  const session = useAgentSession(props.sessionKey, {
    isLive: props.isLive || step.remote?.liveHistoryVersion === 1,
    status: step.status,
    isRemote: step.execution?.target.kind === "remote",
  });
  const commands = useSessionCommands(props.sessionKey, session.refresh);
  const view = remoteSessionView(session.view, step);
  const canStop = view?.actions.canCancelRun === true && !props.isReadOnly;
  const activity = sessionActivity(terminal, session, step);
  return (
    <>
      {props.header(
        view?.state ?? null,
        canStop ? () => commands.cancel("run") : undefined,
      )}
      <SessionNotice session={session} hasView={view !== null} />
      {view && step.session ? (
        <div
          className={
            props.isTerminal
              ? "flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden"
              : "flex min-h-0 flex-1 flex-col lg:flex-row"
          }
        >
          {props.isTerminal ? (
            <ConsoleTerminal
              sessionKey={props.sessionKey}
              nodeName={props.nodeName}
              onCloseRequest={props.onClose}
              onState={setTerminal}
            />
          ) : (
            <AcpColumn
              session={session}
              view={view}
              step={step}
              isReadOnly={props.isReadOnly}
              commands={commands}
            />
          )}
          <SessionFacts
            view={view}
            step={step}
            terminal={terminal}
            isTerminal={props.isTerminal}
            isReadOnly={props.isReadOnly}
            commands={commands}
            activity={activity}
          />
        </div>
      ) : null}
    </>
  );
}
