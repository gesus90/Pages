import { MessagesSquare } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { SettingsCard } from "@/app/components/settings/settings-layout";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { AGENT_CHAT_TASK_LIMIT_RANGE } from "@/definition/AgentChatTask";
import { AGENT_CHAT_HOURLY_LIMIT_RANGE } from "@/definition/Conversation";

import type { AgentActionResult } from "@/app/lib/settings-actions/settings-agents-response.server";
import type { AgentChatSettings } from "@/definition/Conversation";

function AgentChatSaveFeedback({
  result,
}: {
  readonly result: AgentActionResult | undefined;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (result === undefined) return null;
  if (result.ok)
    return result.intent === "save-agent-chat" ? (
      <p role="status" className="text-sm text-success">
        {t("agentChatSettings.saved")}
      </p>
    ) : null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {t([`settings.agents.error.${result.error}`, "chat.error.general"])}
    </p>
  );
}

/** The limit of scheduled tasks one chat may hold. */
function TaskLimitField({
  settings,
  isPending,
}: {
  readonly settings: AgentChatSettings;
  readonly isPending: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="max-w-xs">
      <label
        htmlFor={id}
        className="mb-1.5 block text-sm font-medium text-foreground"
      >
        {t("agentChatSettings.taskLimit")}
      </label>
      <Input
        id={id}
        name="scheduledTaskLimit"
        type="number"
        inputMode="numeric"
        min={AGENT_CHAT_TASK_LIMIT_RANGE.minimum}
        max={AGENT_CHAT_TASK_LIMIT_RANGE.maximum}
        defaultValue={settings.scheduledTaskLimit}
        disabled={isPending}
        required
      />
      <p className="mt-1.5 text-xs text-muted-foreground">
        {t("agentChatSettings.taskLimitHint", {
          minimum: AGENT_CHAT_TASK_LIMIT_RANGE.minimum,
          maximum: AGENT_CHAT_TASK_LIMIT_RANGE.maximum,
        })}
      </p>
    </div>
  );
}

/**
 * The chat of agents under Settings → Agents: how many messages
 * one agent may send per hour with the Pages tool `chat_send`, and how many
 * scheduled tasks one chat may hold.
 */
export function AgentChatSettingsCard({
  settings,
}: {
  readonly settings: AgentChatSettings;
}): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<AgentActionResult>({ key: "agent-chat-settings" });
  const id = useId();
  const isPending = fetcher.state !== "idle";
  return (
    <SettingsCard
      icon={<MessagesSquare className="size-4" />}
      title={t("agentChatSettings.title")}
      description={t("agentChatSettings.description")}
    >
      <fetcher.Form key={settings.revision} method="post" className="space-y-4">
        <input type="hidden" name="intent" value="save-agent-chat" />
        <input type="hidden" name="revision" value={settings.revision} />
        <div className="max-w-xs">
          <label
            htmlFor={id}
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            {t("agentChatSettings.hourlyLimit")}
          </label>
          <Input
            id={id}
            name="hourlyMessageLimit"
            type="number"
            inputMode="numeric"
            min={AGENT_CHAT_HOURLY_LIMIT_RANGE.minimum}
            max={AGENT_CHAT_HOURLY_LIMIT_RANGE.maximum}
            defaultValue={settings.hourlyMessageLimit}
            disabled={isPending}
            required
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            {t("agentChatSettings.hourlyLimitHint", {
              minimum: AGENT_CHAT_HOURLY_LIMIT_RANGE.minimum,
              maximum: AGENT_CHAT_HOURLY_LIMIT_RANGE.maximum,
            })}
          </p>
        </div>
        <TaskLimitField settings={settings} isPending={isPending} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <AgentChatSaveFeedback
            result={isPending ? undefined : fetcher.data}
          />
          <Button type="submit" size="sm" disabled={isPending}>
            {t("settings.agents.save")}
          </Button>
        </div>
      </fetcher.Form>
    </SettingsCard>
  );
}
