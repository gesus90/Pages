import { eventKey, nameOf, weekdaysLabel } from "./automation-labels";

import type {
  Automation,
  AutomationAgentAction,
  AutomationTrigger,
} from "@/definition/Automation";
import type { LabelContext } from "./automation-time-format";

const ALL_WEEKDAYS = 7;

/** When an automation runs, as the sentence names it. */
type SentenceTiming = "schedule" | "event" | "manual";

function timingOf(trigger: AutomationTrigger): SentenceTiming {
  if (trigger.type === "event") return "event";
  if (trigger.type === "manual") return "manual";
  return "schedule";
}

function scheduleText(
  trigger: AutomationTrigger,
  context: LabelContext,
): string {
  const { t } = context;
  if (trigger.type === "weekly")
    return t("automations.schedule.atTimes", {
      days: weekdaysLabel(t, trigger.weekdays),
      times: trigger.times.join(", "),
    });
  if (trigger.type !== "interval") return t("automations.schedule.once");
  const every = t(`automations.intervalLong.${trigger.unit}`, {
    count: trigger.every,
  });
  const weekdays = trigger.weekdays ?? [];
  if (weekdays.length === 0 || weekdays.length === ALL_WEEKDAYS) return every;
  return t("automations.schedule.onDays", {
    every,
    days: weekdaysLabel(t, weekdays),
  });
}

function eventClause(
  trigger: AutomationTrigger,
  context: LabelContext,
): string {
  if (trigger.type !== "event") return "";
  return context.t(`automations.eventClauses.${eventKey(trigger.eventType)}`);
}

/** `[[Chatname]]` names a group as the target chat of an agent action; anything else is `@Agentname`, a direct chat. */
const GROUP_TARGET = /^\[\[(.+)\]\]$/u;

function chatSentence(
  chat: string | null | undefined,
  context: LabelContext,
): string {
  const target = chat?.trim() ?? "";
  if (target === "") return "";
  const { t } = context;
  const group = GROUP_TARGET.exec(target)?.[1];
  if (group !== undefined)
    return t("automations.description.chatGroup", { chat: group });
  return t("automations.description.chatDirect", {
    chat: target.replace(/^@/u, ""),
  });
}

function agentSentence(
  automation: Automation,
  action: AutomationAgentAction,
  context: LabelContext,
): string {
  const { t } = context;
  const agent = nameOf(context, action.agentId);
  const sentence =
    automation.trigger.type === "once"
      ? t(
          automation.deleteAfterSuccess
            ? "automations.description.agent.onceDelete"
            : "automations.description.agent.once",
          { agent },
        )
      : t(`automations.description.agent.${timingOf(automation.trigger)}`, {
          agent,
          schedule: scheduleText(automation.trigger, context),
          event: eventClause(automation.trigger, context),
        });
  return [sentence, chatSentence(action.chat, context)]
    .filter((part) => part !== "")
    .join(" ");
}

function scriptForwardSentence(
  automation: Automation,
  context: LabelContext,
): string {
  if (automation.action.type !== "script" || !automation.action.forward)
    return "";
  return context.t(
    `automations.description.forward.${automation.action.forward.when}`,
    { agent: nameOf(context, automation.action.forward.agentId) },
  );
}

function deleteSentence(automation: Automation, context: LabelContext): string {
  if (automation.trigger.type !== "once" || !automation.deleteAfterSuccess)
    return "";
  return context.t("automations.description.deleteAfter");
}

/**
 * Says in one or two sentences what an automation does, such as "Läuft
 * einmal als Auftrag an Jiraiya und löscht sich danach selbst."
 */
export function automationDescription(
  automation: Automation,
  context: LabelContext,
): string {
  const { action, trigger } = automation;
  if (action.type === "agent")
    return agentSentence(automation, action, context);
  const values = {
    schedule: scheduleText(trigger, context),
    event: eventClause(trigger, context),
    plan: action.type === "plan" ? nameOf(context, action.planId) : "",
  };
  const lead = context.t(
    `automations.description.${action.type}.${timingOf(trigger)}`,
    values,
  );
  return [
    lead,
    scriptForwardSentence(automation, context),
    deleteSentence(automation, context),
  ]
    .filter((sentence) => sentence !== "")
    .join(" ");
}
