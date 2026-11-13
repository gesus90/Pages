import { expect, it } from "vitest";

import {
  isDreamDue,
  isValidDreamSchedule,
  nextDreamRun,
} from "@/backend/service/employee/AgentDreamSchedule";
import { toDatabaseTime } from "@/backend/service/employee/AgentEmployeeText";

import type { AgentDreamScheduleSource } from "@/backend/service/employee/AgentDreamSchedule";
import type { AgentDreamSchedule } from "@/definition/AgentDreaming";

const INSTANCE_TIME = "03:00";

function schedule(
  overrides: Partial<AgentDreamSchedule> = {},
): AgentDreamSchedule {
  return {
    isEnabled: true,
    interval: 1,
    unit: "days",
    time: null,
    weekday: null,
    isOnFullLogbook: true,
    ...overrides,
  };
}

/** Local times, because the schedule runs in the time zone of the server. */
function local(...parts: [number, number, number, number?, number?]): Date {
  const [year, month, day, hours = 0, minutes = 0] = parts;
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

function agent(
  dreamSchedule: AgentDreamSchedule,
  lastRun: Date | null,
  extra: Partial<AgentDreamScheduleSource> = {},
): AgentDreamScheduleSource {
  return {
    dreamSchedule,
    lastLearningAt: lastRun === null ? null : toDatabaseTime(lastRun),
    createdAt: toDatabaseTime(local(2026, 1, 1, 10)),
    dreamRequest: null,
    ...extra,
  };
}

it("counts hours from the last run: every 1 hour and every 6 hours", () => {
  const last = local(2026, 11, 13, 9, 30);
  expect(
    nextDreamRun(
      agent(schedule({ interval: 1, unit: "hours" }), last),
      INSTANCE_TIME,
    ),
  ).toEqual(local(2026, 11, 13, 10, 30));
  expect(
    nextDreamRun(
      agent(schedule({ interval: 6, unit: "hours" }), last),
      INSTANCE_TIME,
    ),
  ).toEqual(local(2026, 11, 13, 15, 30));
});

it("runs daily at the time of the agent, and at the time of the instance without one", () => {
  const last = local(2026, 11, 13, 2, 5);
  expect(
    nextDreamRun(agent(schedule({ time: "02:00" }), last), INSTANCE_TIME),
  ).toEqual(local(2026, 11, 14, 2, 0));
  expect(
    nextDreamRun(agent(schedule(), local(2026, 11, 13, 3, 5)), INSTANCE_TIME),
  ).toEqual(local(2026, 11, 14, 3, 0));
  // A run before the time of the day still finds it ahead the same day.
  expect(
    nextDreamRun(
      agent(schedule({ time: "02:00" }), local(2026, 11, 13, 1, 0)),
      INSTANCE_TIME,
    ),
  ).toEqual(local(2026, 11, 13, 2, 0));
});

it("runs every Monday at 02:00 whatever day the last run was", () => {
  const weekly = schedule({ interval: 7, time: "02:00", weekday: 1 });
  // 13 November 2026 is a Friday.
  expect(
    nextDreamRun(agent(weekly, local(2026, 11, 13, 9)), INSTANCE_TIME),
  ).toEqual(local(2026, 11, 16, 2, 0));
  // A run on Monday at 02:00 itself leads to the next Monday.
  expect(
    nextDreamRun(agent(weekly, local(2026, 11, 16, 2, 0)), INSTANCE_TIME),
  ).toEqual(local(2026, 11, 23, 2, 0));
  // Sunday is 7.
  expect(
    nextDreamRun(
      agent(
        schedule({ interval: 7, time: "02:00", weekday: 7 }),
        local(2026, 11, 13, 9),
      ),
      INSTANCE_TIME,
    )?.getDay(),
  ).toBe(0);
});

it("runs every 30 days at 02:00, counted from the last run", () => {
  const monthly = schedule({ interval: 30, time: "02:00" });
  expect(
    nextDreamRun(agent(monthly, local(2026, 11, 13, 2, 0)), INSTANCE_TIME),
  ).toEqual(local(2026, 12, 13, 2, 0));
  // A run that came late moves the following ones.
  expect(
    nextDreamRun(agent(monthly, local(2026, 11, 13, 5, 30)), INSTANCE_TIME),
  ).toEqual(local(2026, 12, 13, 2, 0));
  expect(
    nextDreamRun(
      agent(
        schedule({ interval: 3, time: "02:00" }),
        local(2026, 11, 13, 2, 0),
      ),
      INSTANCE_TIME,
    ),
  ).toEqual(local(2026, 11, 16, 2, 0));
});

it("counts from the creation of an agent that never dreamed, and has no next run while off", () => {
  expect(
    nextDreamRun(
      agent(schedule({ interval: 2, unit: "hours" }), null),
      INSTANCE_TIME,
    ),
  ).toEqual(local(2026, 1, 1, 12, 0));
  expect(
    nextDreamRun(agent(schedule({ isEnabled: false }), null), INSTANCE_TIME),
  ).toBeNull();
});

it("is due once the next run has come, never before, and not while off", () => {
  const hourly = agent(
    schedule({ interval: 1, unit: "hours" }),
    local(2026, 11, 13, 9, 0),
  );
  expect(isDreamDue(hourly, local(2026, 11, 13, 9, 59), INSTANCE_TIME)).toBe(
    false,
  );
  expect(isDreamDue(hourly, local(2026, 11, 13, 10, 0), INSTANCE_TIME)).toBe(
    true,
  );
  const off = agent(
    schedule({ isEnabled: false, interval: 1, unit: "hours" }),
    local(2026, 11, 13, 1, 0),
  );
  expect(isDreamDue(off, local(2026, 11, 14, 1, 0), INSTANCE_TIME)).toBe(false);
});

it("is due for a run somebody asked for, even while the schedule is off", () => {
  const asked = agent(
    schedule({ isEnabled: false }),
    local(2026, 11, 13, 9, 0),
    {
      dreamRequest: { at: "2026-11-13 09:05:00", trigger: "manual" },
    },
  );
  expect(isDreamDue(asked, local(2026, 11, 13, 9, 6), INSTANCE_TIME)).toBe(
    true,
  );
});

it("accepts every interval from one hour to 30 days and refuses what lies outside", () => {
  expect(isValidDreamSchedule(schedule({ interval: 1, unit: "hours" }))).toBe(
    true,
  );
  expect(isValidDreamSchedule(schedule({ interval: 720, unit: "hours" }))).toBe(
    true,
  );
  expect(isValidDreamSchedule(schedule({ interval: 721, unit: "hours" }))).toBe(
    false,
  );
  expect(isValidDreamSchedule(schedule({ interval: 30, time: "02:00" }))).toBe(
    true,
  );
  expect(isValidDreamSchedule(schedule({ interval: 31 }))).toBe(false);
  expect(isValidDreamSchedule(schedule({ interval: 0 }))).toBe(false);
  expect(isValidDreamSchedule(schedule({ interval: 1.5 }))).toBe(false);
  expect(isValidDreamSchedule(schedule({ time: "25:00" }))).toBe(false);
  // A time of day belongs to days, a weekday to a weekly interval.
  expect(
    isValidDreamSchedule(
      schedule({ interval: 6, unit: "hours", time: "02:00" }),
    ),
  ).toBe(false);
  expect(isValidDreamSchedule(schedule({ interval: 7, weekday: 1 }))).toBe(
    true,
  );
  expect(isValidDreamSchedule(schedule({ interval: 6, weekday: 1 }))).toBe(
    false,
  );
  expect(isValidDreamSchedule(schedule({ interval: 7, weekday: 8 }))).toBe(
    false,
  );
});
