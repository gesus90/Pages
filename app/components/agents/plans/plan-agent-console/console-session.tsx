import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ConsoleComposer } from "./console-composer";
import { ConsoleFailure } from "./console-failure";
import { ConsoleSidebar } from "./console-sidebar";
import { consoleStepState, hasSessionEnded } from "./console-step-state";
import { ConsoleTerminal } from "./console-terminal";
import { useAgentSession } from "./use-agent-session";
import { useSessionCommands } from "./use-session-commands";
import { useNow } from "./use-terminal-surface";
import { PlanRemoteHistoryNotice } from "../plan-remote-history";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type {
  AgentSessionKey,
  AgentSessionView,
} from "@/definition/AgentSessionJournal";
import type { ConsoleStepState } from "./console-step-state";
import type { TerminalInputMode } from "./console-terminal";
import type { SessionCommands } from "./use-session-commands";

interface ConsoleSessionProps {
  readonly sessionKey: AgentSessionKey;
  readonly step: AgentPlanStepResult;
  readonly isLive: boolean;
  readonly isReadOnly: boolean;
  /** The instruction of the node, the plan prompt of its first attempt. */
  readonly prompt: string | null;
  readonly onClose: () => void;
  /** Draws the header with the translated state and the stop of the run. */
  readonly header: (
    stateLabel: string | null,
    onStopRun: (() => Promise<void>) | undefined,
  ) => React.ReactNode;
}

/** Narrow windows and touch devices type in the field below the terminal instead of its line. */
const COMPACT_QUERY =
  "(max-width: 679.98px), (hover: none) and (pointer: coarse)";

function useIsCompact(): boolean {
  const [isCompact, setCompact] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(COMPACT_QUERY);
    function update(): void {
      setCompact(query.matches);
    }
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return isCompact;
}

function stateLabel(
  state: ConsoleStepState | null,
  t: ReturnType<typeof useTranslation>["t"],
): string | null {
  if (!state) return null;
  const key = "plans.console.terminal.state";
  if (state.kind === "resume")
    return t(`${key}.resume`, { seconds: state.seconds });
  if (state.kind === "session") return t(`plans.console.state.${state.state}`);
  return t(`${key}.${state.kind}`);
}

function modelLabel(
  view: AgentSessionView | null,
  step: AgentPlanStepResult,
): string {
  return (
    view?.model.confirmedModel.value ?? step.session?.requested.model ?? ""
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
      <p role="alert" className="px-5 py-4 text-sm text-agent-terminal-error">
        {t([
          `settings.agents.error.${session.error}`,
          "settings.agents.error.general",
        ])}
      </p>
    );
  if (session.connection !== "loading") return null;
  return (
    <p role="status" className="px-5 py-4 text-sm text-agent-console-muted">
      {t("plans.console.loading")}
    </p>
  );
}

/** The terminal with its input on the left and the sidebar on the right; below 680 px stacked. */
function SessionBody(
  props: ConsoleSessionProps & {
    readonly view: AgentSessionView;
    readonly session: ReturnType<typeof useAgentSession>;
    readonly commands: SessionCommands;
  },
): React.ReactElement {
  const { t } = useTranslation();
  const { step, view, commands } = props;
  const isCompact = useIsCompact();
  const hasEnded = hasSessionEnded(step) || !props.isLive;
  const canType = view.actions.canSend && !props.isReadOnly;
  const canInterrupt = view.actions.canCancelTurn;
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-agent-terminal-surface min-[680px]:flex-row min-[680px]:overflow-hidden">
      <div className="flex min-w-0 shrink-0 flex-col min-[680px]:min-h-0 min-[680px]:flex-1 min-[680px]:shrink">
        <ConsoleFailure remote={step.remote} />
        <ConsoleTerminal
          sessionKey={props.sessionKey}
          step={step}
          session={props.session}
          commands={commands}
          provider={t(`settings.agents.provider.${view.provider}`)}
          model={modelLabel(view, step)}
          prompt={props.prompt}
          inputMode={inputModeOf({ hasEnded, canType, isCompact })}
          canInterrupt={canInterrupt}
          onCloseRequest={props.onClose}
        />
        <PlanRemoteHistoryNotice step={step} />
        {isCompact && canType && !hasEnded ? (
          <ConsoleComposer
            view={view}
            isReadOnly={props.isReadOnly}
            commands={commands}
            canInterrupt={canInterrupt}
          />
        ) : null}
      </div>
      <ConsoleSidebar step={step} view={view} />
    </div>
  );
}

/** The ended line after the session, the input line where a person may type, else nothing. */
function inputModeOf(facts: {
  readonly hasEnded: boolean;
  readonly canType: boolean;
  readonly isCompact: boolean;
}): TerminalInputMode {
  if (facts.hasEnded) return "ended";
  return facts.canType && !facts.isCompact ? "line" : "none";
}

/**
 * The session of one node: the Pages terminal on the left, the sidebar on the right (PAGE-284).
 *
 * @remarks
 * Every provider looks and works the same. Below 680 px the sidebar stands
 * under the terminal, and the field below the terminal takes the input with
 * send and interrupt. The caller mounts it once per session key, so a node
 * or run switch starts from empty data.
 */
export function ConsoleSession(props: ConsoleSessionProps): React.ReactElement {
  const { t } = useTranslation();
  const { step } = props;
  const session = useAgentSession(props.sessionKey, {
    isLive: props.isLive || step.remote?.liveHistoryVersion === 1,
    status: step.status,
    isRemote: step.execution?.target.kind === "remote",
  });
  const commands = useSessionCommands(props.sessionKey, session.refresh);
  const now = useNow(step.session?.retry?.state === "waiting");
  const { view } = session;
  const canStop = view?.actions.canCancelRun === true && !props.isReadOnly;
  return (
    <>
      {props.header(
        stateLabel(consoleStepState(step, view?.state ?? null, now), t),
        canStop ? () => commands.cancel("run") : undefined,
      )}
      <SessionNotice session={session} hasView={view !== null} />
      {view && step.session ? (
        <SessionBody
          {...props}
          view={view}
          session={session}
          commands={commands}
        />
      ) : null}
    </>
  );
}
