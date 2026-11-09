import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import type { AgentSessionView } from "@/definition/AgentSessionJournal";
import type { SessionCommands } from "./use-session-commands";

/**
 * How the next instruction would continue, and the turn cancel the backend offers.
 *
 * @remarks
 * Same session, native recovery and a new session with bounded context read
 * differently. Only actions the backend view allows appear; recovery and
 * continuing the plan are offered once the backend confirms them.
 */
export function ConsoleControls({
  view,
  isReadOnly,
  commands,
}: {
  readonly view: AgentSessionView;
  readonly isReadOnly: boolean;
  readonly commands: SessionCommands;
}): React.ReactElement {
  const { t } = useTranslation();
  const { actions, continuation } = view;
  const canCancelTurn = actions.canCancelTurn && !isReadOnly;
  return (
    <section aria-labelledby="console-controls" className="space-y-2 text-xs">
      <h3 id="console-controls" className="text-sm font-semibold">
        {t("plans.console.continuation.title")}
      </h3>
      <p>{t(`plans.console.continuation.mode.${continuation.mode}`)}</p>
      {continuation.reason ? (
        <p className="text-muted-foreground">
          {t(`plans.console.continuation.reason.${continuation.reason}`, {
            defaultValue: continuation.reason,
          })}
        </p>
      ) : null}
      {view.state === "waiting_for_capacity" ? (
        <p className="text-muted-foreground">
          {t("plans.console.waitingForCapacity")}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {canCancelTurn ? (
          <Button
            size="sm"
            variant="outline"
            disabled={commands.isPending}
            onClick={() => void commands.cancel("turn")}
          >
            {t("plans.console.cancelTurn")}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
