import { Layers } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import {
  ControlRow,
  SettingsCard,
} from "@/app/components/settings/settings-layout";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import {
  AGENT_CHAT_IDLE_MAXIMUM_MINUTES,
  AGENT_SESSION_LIMIT_MAXIMUM,
} from "@/definition/AgentSessionLimits";

import type { AgentActionResult } from "@/app/lib/settings-actions/settings-agents-response.server";
import type { AgentSessionLimitsAdministration } from "@/definition/AgentSessionLimits";

interface AgentSessionLimitsCardProps {
  readonly administration: AgentSessionLimitsAdministration;
}

/** Says whether saving worked, or why not. */
function SaveFeedback({
  result,
}: {
  readonly result: AgentActionResult | undefined;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (result === undefined) return null;
  if (result.ok)
    return (
      <p role="status" className="text-sm text-success">
        {t("agentSessionLimits.saved")}
      </p>
    );
  return (
    <p role="alert" className="text-sm text-destructive">
      {t([
        `agentSessionLimits.error.${result.error}`,
        `settings.agents.error.${result.error}`,
        "chat.error.general",
      ])}
    </p>
  );
}

function LimitField({
  name,
  label,
  value,
  disabled,
}: {
  readonly name: "perAgent" | "total";
  readonly label: string;
  readonly value: number;
  readonly disabled: boolean;
}): React.ReactElement {
  return (
    <ControlRow label={label}>
      <Input
        className="w-24"
        name={name}
        type="number"
        min={1}
        max={AGENT_SESSION_LIMIT_MAXIMUM}
        step={1}
        required
        inputMode="numeric"
        defaultValue={value}
        disabled={disabled}
        aria-label={label}
      />
    </ControlRow>
  );
}

/**
 * The limits of concurrent chat sessions of agents (PAGE-304), the time
 * of day of the nightly dream run (PAGE-305) and the idle time after which a
 * resting chat session ends (PAGE-335).
 *
 * @remarks
 * Every chat of an agent has its own session; sessions of different chats
 * run side by side. Above a limit a message waits in the queue and the chat
 * says so; it is never refused. The card shows how many sessions run and
 * wait now, as of loading the page.
 */
export function AgentSessionLimitsCard({
  administration,
}: AgentSessionLimitsCardProps): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<AgentActionResult>({
    key: "agent-session-limits",
  });
  const isPending = fetcher.state !== "idle";
  const { limits } = administration;
  return (
    <SettingsCard
      icon={<Layers className="size-4" />}
      title={t("agentSessionLimits.title")}
      description={t("agentSessionLimits.description")}
    >
      <fetcher.Form
        key={limits.revision}
        method="post"
        className="space-y-3"
        aria-busy={isPending}
      >
        <input type="hidden" name="intent" value="save-agent-session-limits" />
        <input type="hidden" name="revision" value={limits.revision} />
        <LimitField
          name="perAgent"
          label={t("agentSessionLimits.perAgent")}
          value={limits.perAgent}
          disabled={isPending}
        />
        <LimitField
          name="total"
          label={t("agentSessionLimits.total")}
          value={limits.total}
          disabled={isPending}
        />
        <p className="text-xs text-muted-foreground">
          {t("agentSessionLimits.hint", {
            maximum: AGENT_SESSION_LIMIT_MAXIMUM,
          })}
        </p>
        <ControlRow label={t("agentSessionLimits.dreamTime")}>
          <Input
            className="w-32"
            name="dreamTime"
            type="time"
            required
            defaultValue={limits.dreamTime}
            disabled={isPending}
            aria-label={t("agentSessionLimits.dreamTime")}
          />
        </ControlRow>
        <p className="text-xs text-muted-foreground">
          {t("agentSessionLimits.dreamTimeHint")}
        </p>
        <ControlRow label={t("agentSessionLimits.idleMinutes")}>
          <Input
            className="w-24"
            name="idleMinutes"
            type="number"
            min={1}
            max={AGENT_CHAT_IDLE_MAXIMUM_MINUTES}
            step={1}
            required
            inputMode="numeric"
            defaultValue={limits.idleMinutes}
            disabled={isPending}
            aria-label={t("agentSessionLimits.idleMinutes")}
          />
        </ControlRow>
        <p className="text-xs text-muted-foreground">
          {t("agentSessionLimits.idleMinutesHint", {
            maximum: AGENT_CHAT_IDLE_MAXIMUM_MINUTES,
          })}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("agentSessionLimits.current", {
            running: administration.running,
            waiting: administration.waiting,
          })}
        </p>
        <div className="flex justify-end">
          <Button type="submit" disabled={isPending}>
            {t(
              isPending
                ? "agentSessionLimits.saving"
                : "agentSessionLimits.save",
            )}
          </Button>
        </div>
        <SaveFeedback result={isPending ? undefined : fetcher.data} />
      </fetcher.Form>
    </SettingsCard>
  );
}
