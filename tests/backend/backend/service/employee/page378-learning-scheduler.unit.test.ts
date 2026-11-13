import { expect, it } from "vitest";

import { AgentLearningScheduler } from "@/backend/service/employee/AgentLearningScheduler";
import { toDatabaseTime } from "@/backend/service/employee/AgentEmployeeText";
import { AGENT_DREAM_DEFAULT_SCHEDULE } from "@/definition/AgentDreaming";

import { EMPTY_ANSWER, dreamWorld, entry } from "./page378-dream-fixture";

import type { AgentDreamSchedule } from "@/definition/AgentDreaming";

/** Local clock times, because the schedule runs in the time zone of the server. */
function local(day: number, hours: number, minutes = 0): Date {
  return new Date(2026, 10, day, hours, minutes, 0, 0);
}

function scheduled(schedule: Partial<AgentDreamSchedule>, lastRun: Date) {
  const world = dreamWorld({
    ...EMPTY_ANSWER,
    lessons: [
      { text: "Eine Lektion zum Test.", evidence: "Test", date: "2026-11-13" },
    ],
  });
  world.logbook.entries = [entry(1)];
  world.employee.value = {
    ...world.employee.value,
    dreamSchedule: { ...AGENT_DREAM_DEFAULT_SCHEDULE, ...schedule },
    lastLearningAt: toDatabaseTime(lastRun),
  };
  const scheduler = new AgentLearningScheduler(
    {
      employees: () => ({ list: async () => [world.employee.value] }),
    } as never,
    world.service,
  );
  return { world, scheduler };
}

it("starts the run at the scheduled time and not a minute before", async () => {
  const { world, scheduler } = scheduled({ time: "02:00" }, local(12, 2, 0));

  world.clock.value = local(13, 1, 59);
  await scheduler.runDue();
  expect(world.model.dream).not.toHaveBeenCalled();

  world.clock.value = local(13, 2, 0);
  await scheduler.runDue();
  expect(world.model.dream).toHaveBeenCalledTimes(1);
  expect(world.saved.runs[0]).toMatchObject({ trigger: "schedule" });

  // The run counts as the last one: the next look at the same moment starts nothing.
  await scheduler.runDue();
  expect(world.model.dream).toHaveBeenCalledTimes(1);
});

it("starts an hourly run an hour after the last one", async () => {
  const { world, scheduler } = scheduled(
    { interval: 1, unit: "hours", time: null },
    local(13, 9, 0),
  );
  world.clock.value = local(13, 9, 59);
  await scheduler.runDue();
  expect(world.model.dream).not.toHaveBeenCalled();
  world.clock.value = local(13, 10, 0);
  await scheduler.runDue();
  expect(world.model.dream).toHaveBeenCalledTimes(1);
});

it("postpones a due run while the agent works in a chat and starts it at the next quiet look", async () => {
  const { world, scheduler } = scheduled({ time: "02:00" }, local(12, 2, 0));
  world.clock.value = local(13, 2, 0);
  world.isWorking.value = true;

  await scheduler.runDue();
  await scheduler.runDue();
  expect(world.model.dream).not.toHaveBeenCalled();
  expect(world.saved.runs).toEqual([]);

  world.isWorking.value = false;
  world.clock.value = local(13, 2, 1);
  await scheduler.runDue();
  expect(world.model.dream).toHaveBeenCalledTimes(1);
});

it("does not start an agent whose dream run is off, and runs a requested run whatever the schedule says", async () => {
  const { world, scheduler } = scheduled(
    { isEnabled: false, time: "02:00" },
    local(1, 2, 0),
  );
  world.clock.value = local(13, 5, 0);
  await scheduler.runDue();
  expect(world.model.dream).not.toHaveBeenCalled();

  world.employee.value = {
    ...world.employee.value,
    dreamRequest: { at: "2026-11-13 04:00:00", trigger: "logbook" },
  };
  await scheduler.runDue();
  expect(world.model.dream).toHaveBeenCalledTimes(1);
  expect(world.saved.runs[0]).toMatchObject({ trigger: "logbook" });
});

it("stops its look and waits for a running one", async () => {
  const { scheduler } = scheduled({}, local(12, 2, 0));
  scheduler.start();
  scheduler.start();
  await expect(scheduler.shutdown()).resolves.toBeUndefined();
});
