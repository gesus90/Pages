import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { effortLabel } from "./chat-page-model-dialog";

import type {
  AgentChatCommandOutcome,
  AgentChatModelChoice,
} from "@/definition/AgentChatControl";
import type { ChatCommandRunner } from "./use-chat-command-runner";

/** A choice of the answer that runs the completed command. */
function ChoiceButton({
  label,
  note,
  onChoose,
}: {
  readonly label: string;
  readonly note?: string;
  readonly onChoose: () => void;
}): React.ReactElement {
  return (
    <li>
      <button
        type="button"
        className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-primary"
        onClick={onChoose}
      >
        <span className="flex-1 truncate">{label}</span>
        {note === undefined ? null : (
          <span className="text-xs text-muted-foreground">{note}</span>
        )}
      </button>
    </li>
  );
}

function ModelChoices({
  outcome,
  onRun,
}: {
  readonly outcome: Extract<AgentChatCommandOutcome, { status: "chooseModel" }>;
  readonly onRun: (text: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { overview } = outcome;
  const current = overview.override ?? overview.standard;
  const mention = outcome.mention === null ? "" : `@${outcome.mention} `;

  function choose(choice: AgentChatModelChoice): void {
    onRun(`/model ${mention}${choice.model}`);
  }

  return (
    <>
      <p>
        {t("chatPage.command.current", {
          agent: overview.agentName,
          model:
            current.reasoningEffort === null
              ? current.name
              : `${current.name} · ${effortLabel(t, current.reasoningEffort)}`,
        })}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {outcome.query === ""
          ? t("chatPage.command.chooseModel")
          : t("chatPage.command.ambiguous", { query: outcome.query })}
      </p>
      {overview.canControl ? (
        <ul className="mt-1 max-h-48 overflow-y-auto">
          {outcome.matches.map((choice) => (
            <ChoiceButton
              key={`${choice.connectionId}:${choice.model}`}
              label={choice.name}
              note={choice.connectionName}
              onChoose={() => choose(choice)}
            />
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs">{t("chatPage.agentMenu.noRight")}</p>
      )}
    </>
  );
}

/** The text of an answer without a choice. */
function outcomeText(
  t: (key: string, options?: Record<string, unknown>) => string,
  outcome: AgentChatCommandOutcome,
): string {
  switch (outcome.status) {
    case "done":
      return t(`chatPage.command.done.${outcome.command}`, {
        agent: outcome.agentName,
      });
    case "unknownModel":
      return t("chatPage.command.unknownModel", { query: outcome.query });
    case "unknownEffort":
      return t("chatPage.command.unknownEffort", {
        effort: outcome.effort,
        efforts: outcome.efforts
          .map((effort) => effortLabel(t, effort))
          .join(", "),
      });
    case "unknownAgent":
      return t("chatPage.command.unknownAgent", { mention: outcome.mention });
    case "forbidden":
      return t("chatPage.command.forbidden");
    case "chooseModel":
    case "chooseAgent":
      return "";
  }
}

function OutcomeBody({
  outcome,
  onRun,
}: {
  readonly outcome: AgentChatCommandOutcome;
  readonly onRun: (text: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  if (outcome.status === "chooseModel")
    return <ModelChoices outcome={outcome} onRun={onRun} />;
  if (outcome.status !== "chooseAgent") return <p>{outcomeText(t, outcome)}</p>;
  return (
    <>
      <p>{t("chatPage.command.chooseAgent")}</p>
      <ul className="mt-1">
        {outcome.agents.map((agent) => (
          <ChoiceButton
            key={agent.id}
            label={agent.name}
            note={`/${outcome.command} @${agent.username}`}
            onChoose={() => onRun(`/${outcome.command} @${agent.username}`)}
          />
        ))}
      </ul>
    </>
  );
}

/**
 * What a chat command answered, above the input field (PAGE-380): the done
 * change, the choice of the agent of a group or of a model, or why nothing
 * happened. It is no message: only the person who typed the command sees it.
 */
export function ChatPageCommandOutcome({
  runner,
}: {
  readonly runner: ChatCommandRunner;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { outcome, failure } = runner;
  if (outcome === null && failure === null) return null;
  return (
    <section
      aria-live="polite"
      className="mr-22 rounded-xl border border-border bg-surface p-3 text-sm shadow-card"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {outcome === null ? (
            <p className="text-destructive" role="alert">
              {t(`chatPage.control.failure.${failure ?? "unavailable"}`)}
            </p>
          ) : (
            <OutcomeBody outcome={outcome} onRun={runner.run} />
          )}
        </div>
        <button
          type="button"
          aria-label={t("chatPage.command.dismiss")}
          className="rounded p-1 text-muted-foreground hover:bg-surface-hover"
          onClick={runner.dismiss}
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      </div>
    </section>
  );
}
