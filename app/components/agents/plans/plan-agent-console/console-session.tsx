import { useTranslation } from "react-i18next";

import { ScrollViewport } from "@/app/components/ui/scroll-viewport";

import { ConsoleComposer } from "./console-composer";
import { ConsoleControls } from "./console-controls";
import { ConsoleHistory } from "./console-history";
import { ConsoleMetadata } from "./console-metadata";
import { ConsoleUsage } from "./console-usage";
import { useAgentSession } from "./use-agent-session";
import { useSessionCommands } from "./use-session-commands";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type {
  AgentSessionKey,
  AgentSessionState,
} from "@/definition/AgentSessionJournal";

interface ConsoleSessionProps {
  readonly sessionKey: AgentSessionKey;
  readonly step: AgentPlanStepResult;
  readonly isLive: boolean;
  readonly isReadOnly: boolean;
  /** Draws the header with what the session reported. */
  readonly header: (state: AgentSessionState | null) => React.ReactNode;
}

function lastActivity(
  createdAt: string | undefined,
  step: AgentPlanStepResult,
): string | null {
  const value =
    createdAt ?? step.session?.turnEndedAt ?? step.session?.startedAt ?? null;
  return value ? new Date(value).toLocaleString() : null;
}

/**
 * The session of one node attempt: history and input on the left, facts on the right.
 *
 * @remarks
 * The caller mounts it once per session key, so a node or run switch starts
 * from empty data and late answers of the previous session are dropped.
 */
export function ConsoleSession(props: ConsoleSessionProps): React.ReactElement {
  const { t } = useTranslation();
  const { step } = props;
  const session = useAgentSession(props.sessionKey, {
    isLive: props.isLive,
    status: step.status,
  });
  const commands = useSessionCommands(props.sessionKey, session.refresh);
  const { view } = session;
  const record = step.session;
  return (
    <>
      {props.header(view?.state ?? null)}
      {session.error && !view ? (
        <p role="alert" className="px-5 py-4 text-sm text-destructive">
          {t([
            `settings.agents.error.${session.error}`,
            "settings.agents.error.general",
          ])}
        </p>
      ) : null}
      {session.connection === "loading" ? (
        <p role="status" className="px-5 py-4 text-sm text-muted-foreground">
          {t("plans.console.loading")}
        </p>
      ) : null}
      {view && record ? (
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="flex min-h-0 flex-1 flex-col">
            <p
              role="status"
              className="px-5 pt-2 text-xs text-muted-foreground"
            >
              {t(`plans.console.connection.${session.connection}`)}
              {session.error
                ? ` · ${t([`settings.agents.error.${session.error}`, "settings.agents.error.general"])}`
                : ""}
            </p>
            <ConsoleHistory
              events={session.events}
              source={session.source}
              retainedFrom={session.retainedFrom}
            />
            <ConsoleComposer
              view={view}
              isReadOnly={props.isReadOnly}
              commands={commands}
            />
          </div>
          <ScrollViewport
            as="aside"
            axis="vertical"
            aria-label={t("plans.console.details")}
            containerClassName="order-first max-h-[35%] shrink-0 lg:order-none lg:max-h-none lg:w-80"
            className="space-y-5 overflow-y-auto border-b border-border px-5 py-4 lg:border-b-0 lg:border-l"
          >
            <ConsoleControls
              view={view}
              isReadOnly={props.isReadOnly}
              commands={commands}
            />
            <ConsoleUsage view={view} />
            <ConsoleMetadata
              view={view}
              record={record}
              lastActivity={lastActivity(
                session.events.at(-1)?.createdAt,
                step,
              )}
            />
          </ScrollViewport>
        </div>
      ) : null}
    </>
  );
}
