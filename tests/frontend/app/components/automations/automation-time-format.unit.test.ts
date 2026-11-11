import { expect, it } from "vitest";

import {
  formatDayTime,
  formatDuration,
  formatNextRun,
  formatPastMoment,
  formatRunMoment,
} from "@/app/components/automations/automation-time-format";
import { createI18n } from "@/app/lib/i18n";

import { automation, now } from "./automation-fixture";

const t = createI18n("en").t;
const context = { t, now, timeZone: "UTC", language: "en-US", names: {} };

it("formats calendar days in the requested time zone", () => {
  expect(formatDayTime(new Date("2026-01-01T09:00:00Z"), context)).toBe(
    t("automations.time.today", { time: "09:00" }),
  );
  expect(formatDayTime(new Date("2026-01-02T09:00:00Z"), context)).toBe(
    t("automations.time.tomorrow", { time: "09:00" }),
  );
  expect(formatDayTime(new Date("2025-12-31T09:00:00Z"), context)).toBe(
    t("automations.time.yesterday", { time: "09:00" }),
  );
  expect(formatDayTime(new Date("2026-01-03T09:00:00Z"), context)).toBe(
    `${t("automations.weekdays.short.6")} 09:00`,
  );
  expect(formatDayTime(new Date("2026-01-10T09:00:00Z"), context)).toBe(
    `${t("automations.weekdays.short.6")} 01/10 09:00`,
  );
  expect(
    formatDayTime(new Date("2026-01-01T23:30:00Z"), context, "Europe/Berlin"),
  ).toBe(t("automations.time.tomorrow", { time: "00:30" }));
});

it("handles missing, invalid, recent, older and future moments", () => {
  expect(formatPastMoment(null, context)).toBe("—");
  expect(formatRunMoment("invalid", context)).toBe("—");
  expect(formatPastMoment("2025-12-31T23:59:30Z", context)).toBe(
    t("automations.time.justNow"),
  );
  expect(formatPastMoment("2025-12-31T23:51:00Z", context)).toBe(
    t("automations.time.minutesAgo", { count: 9 }),
  );
  expect(formatPastMoment("2025-12-31T23:00:00Z", context)).toBe(
    t("automations.time.yesterday", { time: "23:00" }),
  );
  expect(formatRunMoment("2026-01-01T09:00:00Z", context)).toBe(
    t("automations.time.today", { time: "09:00" }),
  );
});

it("chooses next-run labels and rounds upcoming minutes", () => {
  expect(formatNextRun({ ...automation, isActive: false }, context)).toBe(
    t("automations.next.paused"),
  );
  expect(formatNextRun(automation, context)).toBe(t("automations.next.manual"));
  const scheduled = {
    ...automation,
    trigger: { type: "once" as const, at: null, timeZone: "UTC" },
  };
  expect(formatNextRun(scheduled, context)).toBe("—");
  expect(
    formatNextRun({ ...scheduled, nextRunAt: "2026-01-01T00:00:30Z" }, context),
  ).toBe(t("automations.time.soon"));
  expect(
    formatNextRun({ ...scheduled, nextRunAt: "2026-01-01T00:02:31Z" }, context),
  ).toBe(t("automations.time.inMinutes", { count: 3 }));
  expect(
    formatNextRun({ ...scheduled, nextRunAt: "2026-01-01T01:00:00Z" }, context),
  ).toBe(t("automations.time.today", { time: "01:00" }));
  expect(
    formatNextRun(
      {
        ...automation,
        trigger: { type: "event", eventType: "plan.failed", planId: null },
      },
      context,
    ),
  ).toBe(t("automations.next.event"));
});

it("formats durations at second, minute and hour boundaries", () => {
  expect(formatDuration(null, t)).toBe("—");
  expect(formatDuration(-1000, t)).toBe(
    t("automations.duration.seconds", { count: 0 }),
  );
  expect(formatDuration(59000, t)).toBe(
    t("automations.duration.seconds", { count: 59 }),
  );
  expect(formatDuration(60000, t)).toBe(
    t("automations.duration.minutes", { count: 1 }),
  );
  expect(formatDuration(3600000, t)).toBe(
    t("automations.duration.hours", { count: 1 }),
  );
  expect(formatDuration(4320000, t)).toBe(
    t("automations.duration.hoursMinutes", { hours: 1, minutes: 12 }),
  );
});
