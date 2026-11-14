import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import {
  AGENT_CHAT_SESSION_IDLE_RANGE,
  AGENT_CHAT_SESSION_RESTART_RANGE,
} from "@/definition/AgentChatSession";

import { formatTokenCount } from "./agent-session-display";

import type { SessionSettingsDraft } from "./use-session-settings-draft";
import type { AgentChatSessionOverview } from "@/definition/AgentChatSession";

function SummaryCard({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="flex min-h-36 flex-col gap-2 rounded-xl border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

interface SettingFieldProps {
  readonly id: string;
  readonly label: string;
  readonly unit: string;
  readonly text: string;
  readonly range: { readonly minimum: number; readonly maximum: number };
  readonly problem: string | null;
  readonly isReadOnly: boolean;
  readonly onChange: (text: string) => void;
}

/** One number entry of the card "Verhalten" with its unit and its problem. */
function SettingField({
  id,
  label,
  unit,
  text,
  range,
  problem,
  isReadOnly,
  onChange,
}: SettingFieldProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground" htmlFor={id}>
        {label}
      </label>
      <div className="flex items-center gap-2">
        <Input
          aria-describedby={problem === null ? undefined : `${id}-problem`}
          aria-invalid={problem !== null}
          className="w-20"
          id={id}
          inputMode="numeric"
          max={range.maximum}
          min={range.minimum}
          onChange={(event) => onChange(event.currentTarget.value)}
          readOnly={isReadOnly}
          step={1}
          type="number"
          value={text}
        />
        <span className="text-sm text-foreground">{unit}</span>
      </div>
      {problem === null ? null : (
        <p
          className="text-xs text-destructive"
          id={`${id}-problem`}
          role="alert"
        >
          {problem}
        </p>
      )}
    </div>
  );
}

/** The card "Verhalten": idle time and restart threshold, with their explanation. */
function BehaviorCard({
  draft,
  isReadOnly,
}: {
  readonly draft: SessionSettingsDraft;
  readonly isReadOnly: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <SummaryCard title={t("agentSessions.cards.behavior")}>
      <div className="flex flex-wrap gap-4">
        <SettingField
          id="agent-session-idle"
          label={t("agentSessions.settings.idleLabel")}
          unit={t("agentSessions.settings.idleUnit")}
          text={draft.idleText}
          range={AGENT_CHAT_SESSION_IDLE_RANGE}
          problem={
            draft.hasIdleProblem
              ? t("agentSessions.settings.idleInvalid", {
                  ...AGENT_CHAT_SESSION_IDLE_RANGE,
                })
              : null
          }
          isReadOnly={isReadOnly}
          onChange={draft.setIdleText}
        />
        <SettingField
          id="agent-session-restart"
          label={t("agentSessions.settings.restartLabel")}
          unit={t("agentSessions.settings.restartUnit")}
          text={draft.restartText}
          range={AGENT_CHAT_SESSION_RESTART_RANGE}
          problem={
            draft.hasRestartProblem
              ? t("agentSessions.settings.restartInvalid", {
                  ...AGENT_CHAT_SESSION_RESTART_RANGE,
                })
              : null
          }
          isReadOnly={isReadOnly}
          onChange={draft.setRestartText}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {isReadOnly
          ? t("agentSessions.settings.readOnly")
          : t("agentSessions.settings.hint")}
      </p>
    </SummaryCard>
  );
}

/**
 * The three cards above the table of sessions: how many are open, the tokens
 * of today and the behavior settings of the agent.
 */
export function AgentSessionsSummary({
  overview,
  draft,
}: {
  readonly overview: AgentChatSessionOverview;
  readonly draft: SessionSettingsDraft;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <SummaryCard title={t("agentSessions.cards.open")}>
        <p className="text-3xl font-semibold text-foreground tabular-nums">
          {overview.openSessions + overview.restingSessions}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("agentSessions.cards.openDetail", {
            active: overview.openSessions,
            resting: overview.restingSessions,
          })}
        </p>
      </SummaryCard>
      <SummaryCard title={t("agentSessions.cards.tokens")}>
        <p className="text-3xl font-semibold text-foreground tabular-nums">
          {formatTokenCount(overview.tokensToday, t, i18n.language)}
        </p>
      </SummaryCard>
      <BehaviorCard draft={draft} isReadOnly={!overview.canChangeSettings} />
    </div>
  );
}
