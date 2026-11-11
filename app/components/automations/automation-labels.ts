import { formatDayMonth, weekdayShort } from "./automation-time-format";
import { formatZonedClock, readZonedParts } from "./automation-zoned-time";

import type {
  Automation,
  AutomationAction,
  AutomationEventTrigger,
  AutomationEventType,
  AutomationIntervalTrigger,
  AutomationRunSummary,
  AutomationTrigger,
  AutomationTriggerType,
} from "@/definition/Automation";
import type { TFunction } from "i18next";
import type { LabelContext } from "./automation-time-format";

/** How a trigger chip is colored: events in the info tone, the rest muted. */
export type TriggerChipTone = "event" | "plain";

/** The text and tone of a trigger chip. */
export interface TriggerChip {
  readonly glyph: string;
  readonly text: string;
  readonly tone: TriggerChipTone;
}

/** The leading glyph of each kind of trigger. */
const TRIGGER_GLYPHS: Readonly<Record<AutomationTriggerType, string>> = {
  manual: "▷",
  once: "①",
  interval: "↻",
  weekly: "↻",
  event: "⚡",
};

const ALL_WEEKDAYS = 7;
const SHORTEST_RANGE = 3;

/** The display name of a reference, or "unbekannt" when Pages does not know it. */
export function nameOf(
  context: LabelContext,
  id: string | null | undefined,
): string {
  if (!id) return context.t("automations.unknownName");
  return context.names[id] ?? context.t("automations.unknownName");
}

function isContiguous(days: readonly number[]): boolean {
  return days.every(
    (day, index) => index === 0 || day === (days[index - 1] ?? 0) + 1,
  );
}

/**
 * Names weekdays: "täglich" for all seven, "Mo–Fr" for a run of at least
 * three, else "Mo, Mi".
 */
export function weekdaysLabel(
  t: TFunction,
  weekdays: readonly number[],
): string {
  const days = [...new Set(weekdays)].sort((left, right) => left - right);
  if (days.length === ALL_WEEKDAYS) return t("automations.schedule.daily");
  const first = days[0];
  const last = days[days.length - 1];
  if (
    first !== undefined &&
    last !== undefined &&
    days.length >= SHORTEST_RANGE &&
    isContiguous(days)
  )
    return t("automations.schedule.range", {
      from: weekdayShort(t, first),
      to: weekdayShort(t, last),
    });
  return days.map((day) => weekdayShort(t, day)).join(", ");
}

function intervalLabel(
  t: TFunction,
  trigger: AutomationIntervalTrigger,
): string {
  const every = t(`automations.interval.${trigger.unit}`, {
    count: trigger.every,
  });
  const weekdays = trigger.weekdays ?? [];
  if (weekdays.length === 0 || weekdays.length === ALL_WEEKDAYS) return every;
  return `${every} · ${weekdaysLabel(t, weekdays)}`;
}

/** The short name of an event, such as "Plan fehlgeschlagen" or "Ticket auf Done". */
export function eventLabel(
  context: LabelContext,
  trigger: Pick<AutomationEventTrigger, "eventType" | "statusId">,
): string {
  if (trigger.eventType === "ticket.status_changed" && trigger.statusId)
    return context.t("automations.events.ticketToStatus", {
      status: nameOf(context, trigger.statusId),
    });
  return context.t(`automations.events.${eventKey(trigger.eventType)}`);
}

/** The translation key part of an event type; the dot would nest the key. */
export function eventKey(eventType: AutomationEventType): string {
  return eventType.replace(".", "_");
}

function onceLabel(
  context: LabelContext,
  at: string | null,
  timeZone: string,
): string {
  if (!at) return context.t("automations.trigger.onceWithoutTime");
  const instant = new Date(at);
  const weekday = weekdayShort(
    context.t,
    readZonedParts(instant, timeZone).weekday,
  );
  return `${weekday} ${formatDayMonth(instant, context.language, timeZone)} ${formatZonedClock(instant, timeZone)}`;
}

/** The text of a trigger without its glyph, such as "Mo–Fr 08:00". */
export function triggerText(
  trigger: AutomationTrigger,
  context: LabelContext,
): string {
  switch (trigger.type) {
    case "manual":
      return context.t("automations.trigger.manual");
    case "once":
      return onceLabel(context, trigger.at, trigger.timeZone);
    case "interval":
      return intervalLabel(context.t, trigger);
    case "weekly":
      return `${weekdaysLabel(context.t, trigger.weekdays)} ${trigger.times.join(", ")}`;
    case "event":
      return eventLabel(context, trigger);
  }
}

/** The chip of an automation's trigger in the table. */
export function triggerChip(
  trigger: AutomationTrigger,
  context: LabelContext,
): TriggerChip {
  return {
    glyph: TRIGGER_GLYPHS[trigger.type],
    text: triggerText(trigger, context),
    tone: trigger.type === "event" ? "event" : "plain",
  };
}

function runTriggerText(
  run: AutomationRunSummary,
  automation: Automation | undefined,
  context: LabelContext,
): string {
  const { t } = context;
  switch (run.trigger.kind) {
    case "manual":
      return t("automations.trigger.manual");
    case "once":
      return t("automations.trigger.once");
    case "interval":
      return t("automations.trigger.interval");
    case "weekly":
      return automation
        ? triggerText(automation.trigger, context)
        : t("automations.trigger.weekly");
    case "event":
      return runEventText(run, automation, context);
  }
}

function runEventText(
  run: AutomationRunSummary,
  automation: Automation | undefined,
  context: LabelContext,
): string {
  const statusId =
    automation?.trigger.type === "event" ? automation.trigger.statusId : null;
  const eventType = run.trigger.eventType ?? "plan.failed";
  const label = eventLabel(context, { eventType, statusId });
  return run.trigger.subject ? `${label} · ${run.trigger.subject}` : label;
}

/**
 * The chip of a run in the history: "↻ Intervall", "⚡ Plan fehlgeschlagen
 * · Pages Test", "▷ manuell".
 */
export function runTriggerChip(
  run: AutomationRunSummary,
  automation: Automation | undefined,
  context: LabelContext,
): TriggerChip {
  return {
    glyph: TRIGGER_GLYPHS[run.trigger.kind],
    text: runTriggerText(run, automation, context),
    tone: run.trigger.kind === "event" ? "event" : "plain",
  };
}

/**
 * The line below an automation's name: "Agent · All Might", "Skript → bei
 * Fehler All Might wecken", "Skript" or "Plan starten · Pages Test".
 */
export function actionLine(
  action: AutomationAction,
  context: LabelContext,
): string {
  const { t } = context;
  switch (action.type) {
    case "agent":
      return t("automations.action.agent", {
        agent: nameOf(context, action.agentId),
      });
    case "plan":
      return t("automations.action.plan", {
        plan: nameOf(context, action.planId),
      });
    case "script":
      if (!action.forward) return t("automations.action.script");
      return t(`automations.action.scriptForward.${action.forward.when}`, {
        agent: nameOf(context, action.forward.agentId),
      });
  }
}
