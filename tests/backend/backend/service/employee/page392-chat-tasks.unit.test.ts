import { describe, expect, it } from "vitest";

import { nextRunAfter } from "@/backend/service/automation/AutomationSchedule";
import {
  chatTaskTrigger,
  describeChatTaskTrigger,
} from "@/backend/service/employee/AgentChatTaskSchedule";

import { AGENT, IGOR, MAYA, NOW, OTHER_AGENT, OUTSIDER, chatTaskWorld } from "./page392-chat-task-world";

const GROUP = { kind: "conversation", conversationId: "group-1", askerId: "igor" } as const;
const DIRECT = { kind: "direct", personId: "igor" } as const;

describe("PAGE-392 schedule in the person's time zone", () => {
  it("plans 'morgen um 9' in Berlin time and names it in plain words", () => {
    const trigger = chatTaskTrigger(
      { type: "once", at: "2026-11-16T09:00" },
      { timeZone: "Europe/Berlin", now: NOW },
    );
    expect(trigger).toEqual({
      type: "once",
      at: "2026-11-16T08:00:00.000Z",
      timeZone: "Europe/Berlin",
    });
    expect(describeChatTaskTrigger(trigger, { now: NOW, language: "de" })).toBe(
      "Morgen, 16.11., 9:00 Uhr",
    );
    expect(describeChatTaskTrigger(trigger, { now: NOW, language: "en" })).toBe(
      "Tomorrow, 11/16, 09:00",
    );
    // The same wall-clock time in New York is another instant.
    expect(
      chatTaskTrigger(
        { type: "once", at: "2026-11-16T09:00" },
        { timeZone: "America/New_York", now: NOW },
      ),
    ).toMatchObject({ at: "2026-11-16T14:00:00.000Z" });
  });

  it("names recurring rhythms and refuses a passed time or a flooding interval", () => {
    const weekly = chatTaskTrigger(
      { type: "weekly", weekdays: [1], times: ["09:00"] },
      { timeZone: "Europe/Berlin", now: NOW },
    );
    expect(describeChatTaskTrigger(weekly, { now: NOW, language: "de" })).toBe(
      "Jeden Montag um 9:00 Uhr",
    );
    const workdays = chatTaskTrigger(
      { type: "weekly", weekdays: [5, 1, 2, 3, 4], times: ["17:30", "08:00"] },
      { timeZone: "Europe/Berlin", now: NOW },
    );
    expect(describeChatTaskTrigger(workdays, { now: NOW, language: "de" })).toBe(
      "Werktags (Mo–Fr) um 8:00 und 17:30 Uhr",
    );
    const hourly = chatTaskTrigger(
      { type: "interval", every: 2, unit: "hour" },
      { timeZone: "Europe/Berlin", now: NOW },
    );
    expect(describeChatTaskTrigger(hourly, { now: NOW, language: "de" })).toBe(
      "Alle 2 Stunden",
    );
    expect(() =>
      chatTaskTrigger(
        { type: "once", at: "2026-11-15T09:00" },
        { timeZone: "Europe/Berlin", now: NOW },
      ),
    ).toThrow(expect.objectContaining({ code: "time_in_past" }));
    expect(() =>
      chatTaskTrigger(
        { type: "interval", every: 1, unit: "minute" },
        { timeZone: "Europe/Berlin", now: NOW },
      ),
    ).toThrow(expect.objectContaining({ code: "invalid" }));
    expect(() =>
      chatTaskTrigger(
        { type: "once", at: "2026-13-40T09:00" },
        { timeZone: "Europe/Berlin", now: NOW },
      ),
    ).toThrow(expect.objectContaining({ code: "invalid" }));
  });

  it("keeps the weekly rhythm from one run to the next", () => {
    const weekly = chatTaskTrigger(
      { type: "weekly", weekdays: [1], times: ["09:00"] },
      { timeZone: "Europe/Berlin", now: NOW },
    );
    const first = nextRunAfter(weekly, NOW, NOW);
    expect(first).toBe("2026-11-16T08:00:00.000Z");
    const second = nextRunAfter(weekly, new Date(first ?? ""), new Date(first ?? ""));
    expect(second).toBe("2026-11-23T08:00:00.000Z");
  });
});

describe("PAGE-392 planning from the chat", () => {
  it("plans a reminder as an automation of the person, bound to the direct chat", async () => {
    const world = chatTaskWorld();
    const tasks = world.service.bind(AGENT.id, DIRECT);
    const receipt = await tasks.create({
      kind: "reminder",
      request: "Erinnere mich morgen um 9 an den Zahnarzt",
      instruction: "Zahnarzttermin",
      schedule: { type: "once", at: "2026-11-16T09:00" },
    });
    expect(receipt.when).toBe("Morgen, 16.11., 9:00 Uhr");
    expect(world.create).toHaveBeenCalledWith(
      IGOR.id,
      expect.objectContaining({
        trigger: { type: "once", at: "2026-11-16T08:00:00.000Z", timeZone: "Europe/Berlin" },
        isActive: true,
        deleteAfterSuccess: true,
        action: {
          type: "agent",
          agentId: AGENT.id,
          instruction: expect.stringContaining(
            "Ursprüngliche Bitte: „Erinnere mich morgen um 9 an den Zahnarzt“",
          ),
        },
      }),
    );
    const [input] = world.create.mock.calls[0]?.slice(1) ?? [];
    expect((input as { action: { instruction: string } }).action.instruction).toContain(
      "beginne mit „Erinnerung:“",
    );
    expect(world.bindings.get(receipt.task.id)).toMatchObject({
      agentId: AGENT.id,
      requesterId: IGOR.id,
      chat: { kind: "direct", personId: IGOR.id },
      kind: "reminder",
    });
    expect(receipt.task).toMatchObject({
      isActive: true,
      nextRunAt: "2026-11-16T08:00:00.000Z",
      requesterName: "Igor",
    });
  });

  it("plans only for a person who addressed the agent in a group both belong to", async () => {
    const world = chatTaskWorld();
    const request = {
      kind: "task",
      request: "Prüfe jeden Montag die offenen Tickets",
      instruction: "Offene Tickets prüfen und zusammenfassen",
      schedule: { type: "weekly", weekdays: [1], times: ["09:00"] },
    } as const;
    const planned = await world.service.bind(AGENT.id, GROUP).create(request);
    expect(planned.when).toBe("Jeden Montag um 9:00 Uhr");
    expect(world.bindings.get(planned.task.id)?.chat).toEqual({
      kind: "group",
      conversationId: "group-1",
    });
    await expect(
      world.service.bind(AGENT.id, { ...GROUP, askerId: null }).create(request),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      world.service.bind(AGENT.id, { ...GROUP, askerId: OUTSIDER.id }).create(request),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      world.service.bind(AGENT.id, { ...GROUP, askerId: OTHER_AGENT.id }).create(request),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("refuses a task beyond the limit of the chat and a time that has passed", async () => {
    const world = chatTaskWorld({ limit: 1 });
    const tasks = world.service.bind(AGENT.id, DIRECT);
    const request = {
      kind: "reminder",
      request: "Erinnerung",
      instruction: "Erinnerung",
      schedule: { type: "interval", every: 1, unit: "day" },
    } as const;
    await tasks.create(request);
    await expect(tasks.create(request)).rejects.toMatchObject({ code: "limit_reached" });
    const fresh = chatTaskWorld();
    await expect(
      fresh.service.bind(AGENT.id, DIRECT).create({
        ...request,
        schedule: { type: "once", at: "2026-11-15T08:00" },
      }),
    ).rejects.toMatchObject({ code: "time_in_past" });
    expect(fresh.create).not.toHaveBeenCalled();
  });
});

describe("PAGE-392 listing, changing and deleting", () => {
  it("lists, changes and deletes only the agent's own tasks of its chat", async () => {
    const world = chatTaskWorld();
    const own = world.service.bind(AGENT.id, GROUP);
    const other = world.service.bind(OTHER_AGENT.id, GROUP);
    const mine = await own.create({
      kind: "task",
      request: "Tickets prüfen",
      instruction: "Offene Tickets prüfen",
      schedule: { type: "interval", every: 1, unit: "day" },
    });
    const theirs = await other.create({
      kind: "reminder",
      request: "Standup",
      instruction: "Standup",
      schedule: { type: "weekly", weekdays: [1, 2, 3, 4, 5], times: ["09:30"] },
    });
    expect((await own.list()).map((receipt) => receipt.task.id)).toEqual([mine.task.id]);
    await expect(own.remove(theirs.task.id)).rejects.toMatchObject({ code: "not_found" });

    const changed = await own.update(mine.task.id, {
      schedule: { type: "weekly", weekdays: [1], times: ["08:00"] },
      instruction: "Offene Tickets prüfen und melden",
    });
    expect(changed.when).toBe("Jeden Montag um 8:00 Uhr");
    expect(world.bindings.get(mine.task.id)?.instruction).toBe(
      "Offene Tickets prüfen und melden",
    );
    expect(world.update).toHaveBeenCalledWith(
      IGOR.id,
      expect.objectContaining({
        automationId: mine.task.id,
        expectedRevision: 1,
        trigger: expect.objectContaining({ type: "weekly", timeZone: "Europe/Berlin" }),
      }),
    );
    const paused = await own.update(mine.task.id, { isActive: false });
    expect(paused.task).toMatchObject({ isActive: false, nextRunAt: null });

    await own.remove(mine.task.id);
    expect(world.remove).toHaveBeenCalledWith(
      IGOR.id,
      expect.objectContaining({ automationId: mine.task.id, confirmed: true }),
    );
    expect(await own.list()).toEqual([]);
  });

  it("shows every task of the chat to its people, who pause and delete them", async () => {
    const world = chatTaskWorld();
    const planned = await world.service.bind(AGENT.id, GROUP).create({
      kind: "task",
      request: "Tickets prüfen",
      instruction: "Tickets prüfen",
      schedule: { type: "interval", every: 1, unit: "day" },
    });
    const chat = { kind: "group", conversationId: "group-1" } as const;
    const listed = await world.service.forChat(MAYA, chat);
    expect(listed).toEqual([
      expect.objectContaining({
        id: planned.task.id,
        agentName: "All Might",
        requesterName: "Igor",
        isActive: true,
      }),
    ]);
    await expect(world.service.forChat(OUTSIDER, chat)).rejects.toMatchObject({
      code: "not_found",
    });
    const paused = await world.service.setActiveForPerson(MAYA, {
      taskId: planned.task.id,
      isActive: false,
    });
    expect(paused).toMatchObject({ isActive: false, nextRunAt: null });
    expect(world.setActive).toHaveBeenCalledWith(
      IGOR.id,
      expect.objectContaining({ isActive: false }),
    );
    await expect(
      world.service.removeForPerson(OUTSIDER, planned.task.id),
    ).rejects.toMatchObject({ code: "not_found" });
    await world.service.removeForPerson(MAYA, planned.task.id);
    expect(await world.service.forChat(MAYA, chat)).toEqual([]);
  });

  it("keeps the tasks of a direct chat to its person", async () => {
    const world = chatTaskWorld();
    const planned = await world.service.bind(AGENT.id, DIRECT).create({
      kind: "reminder",
      request: "Zahnarzt",
      instruction: "Zahnarzt",
      schedule: { type: "once", at: "2026-11-16T09:00" },
    });
    expect(
      await world.service.forChat(IGOR, { kind: "direct", agentId: AGENT.id }),
    ).toHaveLength(1);
    expect(
      await world.service.forChat(MAYA, { kind: "direct", agentId: AGENT.id }),
    ).toEqual([]);
    await expect(
      world.service.removeForPerson(MAYA, planned.task.id),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
