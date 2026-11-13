import { Layers } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import {
  ControlRow,
  SettingsCard,
} from "@/app/components/settings/settings-layout";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
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

/** The key a model of the choice is picked by; empty for the agent's own model. */
function modelKey(
  model: { readonly connectionId: string; readonly model: string } | null,
): string {
  return model === null ? "" : `${model.connectionId}\u001f${model.model}`;
}

/**
 * The model the instance names for the background summary of the Lagebuch
 * (PAGE-377), for agents without a model of their own for it. Saved on its
 * own, so it never conflicts with the limits above.
 */
function LogbookModelForm({
  administration,
}: AgentSessionLimitsCardProps): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<AgentActionResult>({
    key: "agent-logbook-model",
  });
  const isPending = fetcher.state !== "idle";
  const models = administration.logbookModels ?? [];
  const saved = administration.logbookModel ?? null;
  const [selected, setSelected] = useState(modelKey(saved));
  const chosen = models.find((model) => modelKey(model) === selected);
  const options = [
    { value: "", label: t("agentSessionLimits.logbookModelAgent") },
    ...models.map((model) => ({
      value: modelKey(model),
      label: model.label,
    })),
  ];
  return (
    <fetcher.Form method="post" className="space-y-3" aria-busy={isPending}>
      <input type="hidden" name="intent" value="save-agent-logbook-model" />
      <input
        type="hidden"
        name="connectionId"
        value={chosen?.connectionId ?? ""}
      />
      <input type="hidden" name="model" value={chosen?.model ?? ""} />
      <ControlRow label={t("agentSessionLimits.logbookModel")}>
        <Select
          ariaLabel={t("agentSessionLimits.logbookModel")}
          className="w-72"
          disabled={isPending}
          onValueChange={setSelected}
          options={options}
          value={selected}
        />
      </ControlRow>
      <p className="text-xs text-muted-foreground">
        {t("agentSessionLimits.logbookModelHint")}
      </p>
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={isPending}>
          {t(
            isPending
              ? "agentSessionLimits.saving"
              : "agentSessionLimits.logbookModelSave",
          )}
        </Button>
      </div>
      <SaveFeedback result={isPending ? undefined : fetcher.data} />
    </fetcher.Form>
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
      <div className="mt-4 border-t border-border pt-4">
        <LogbookModelForm administration={administration} />
      </div>
    </SettingsCard>
  );
}
