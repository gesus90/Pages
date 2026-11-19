import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { modelBadgeDisplay } from "@/app/components/agents/model-picker/model-catalog";

import { ConsoleComposer } from "./console-composer";
import { providerBadgeKey } from "./console-header-badges";
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
import type { HeaderState, StateTone } from "./console-header-badges";
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
  /** Draws the header with the provider badge, the translated state and the stop of the run. */
  readonly header: (
    provider: string | null,
    state: HeaderState | null,
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

/** Work in progress reads in the primary color, a failure in red, a success in green, any other state in neutral grey. */
function stateTone(state: ConsoleStepState): StateTone {
  if (state.kind === "succeeded") return "success";
  if (state.kind === "blocked" || state.kind === "failed") return "danger";
  if (state.kind !== "session") return "neutral";
  if (state.state === "failed") return "danger";
  const isWorking =
    state.state === "starting" ||
    state.state === "running" ||
    state.state === "recovering";
  return isWorking ? "active" : "neutral";
}

function headerState(
  state: ConsoleStepState | null,
  t: ReturnType<typeof useTranslation>["t"],
): HeaderState | null {
  if (!state) return null;
  const key = "plans.console.terminal.state";
  const tone = stateTone(state);
  if (state.kind === "resume")
    return { label: t(`${key}.resume`, { seconds: state.seconds }), tone };
  if (state.kind === "session")
    return { label: t(`plans.console.state.${state.state}`), tone };
  return { label: t(`${key}.${state.kind}`), tone };
}

function modelLabel(
  view: AgentSessionView | null,
  step: AgentPlanStepResult,
): string {
  // The catalog name of a Claude model, such as Haiku 5.5, rather than an alias such as haiku.
  return (
    (view?.modelIdentity ? modelBadgeDisplay(view.modelIdentity).name : null) ??
    view?.model.confirmedModel.value ??
    step.session?.requested.model ??
    ""
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

function sessionProvider(
  step: AgentPlanStepResult,
  view: AgentSessionView | null,
): string | null {
  if (!step.session) return null;
  return providerBadgeKey(step.session.runner, [
    step.session.requested.model,
    view?.model.requestedModel.value,
    view?.model.confirmedModel.value,
    view?.modelIdentity?.modelId,
  ]);
}

/**
 * The session of one node: the Pages terminal on the left, the sidebar on the right.
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
    isLive:
      props.isLive ||
      step.session?.runnerOwned === true ||
      step.remote?.liveHistoryVersion === 1,
    status: step.status,
  });
  const commands = useSessionCommands(props.sessionKey, session.refresh);
  const now = useNow(step.session?.retry?.state === "waiting");
  const { view } = session;
  const canStop = view?.actions.canCancelRun === true && !props.isReadOnly;
  return (
    <>
      {props.header(
        sessionProvider(step, view),
        headerState(consoleStepState(step, view?.state ?? null, now), t),
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

function ConsoleFailure({
  remote,
}: {
  readonly remote?: {
    readonly reason?: string | null;
    readonly storageError?: string;
  };
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (remote?.reason !== "storage" && !remote?.storageError) return null;
  return (
    <p role="alert" className="px-5 py-2 text-sm text-destructive">
      {t("plans.console.storageFailure", {
        code: remote.storageError ?? "journal_write_failed",
      })}
    </p>
  );
}
