import { expect, it, vi } from "vitest";

import {
  chatInteractionsFor,
  markLogbookSeen,
} from "@/backend/service/employee/AgentEmployeeJobRun";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentEmployeeSessionDependencies } from "@/backend/service/employee/AgentEmployeeSessionTypes";
import type { User } from "@/definition/User";

it("binds chat interactions to the current direct conversation", () => {
  const questions = vi.fn(() => ({ question: true }));
  const tasks = vi.fn(() => ({ task: true }));
  const history = vi.fn(() => ({ history: true }));
  const dependencies = partial<AgentEmployeeSessionDependencies>({
    chatQuestions: () => ({ bind: questions }),
    chatTasks: () => ({ bind: tasks }),
    chatHistory: { bind: history },
  });
  const agent = partial<User>({ id: "agent" });
  expect(
    chatInteractionsFor(dependencies, agent, partial({ own: null })),
  ).toEqual({});
  const result = chatInteractionsFor(
    dependencies,
    agent,
    partial({ own: { kind: "direct", chatId: "person" } }),
  );
  expect(result).toEqual({
    interactions: { question: true },
    chatTasks: { task: true },
    history: { history: true },
  });
  expect(questions).toHaveBeenCalledWith("agent", {
    kind: "direct",
    personId: "person",
  });
  expect(history).toHaveBeenCalledWith("agent", {
    kind: "direct",
    personId: "person",
  });
});

it("marks only an actual logbook position and tolerates storage failure", async () => {
  const markSeen = vi.fn(async () => {
    throw new Error("offline");
  });
  const dependencies = partial<AgentEmployeeSessionDependencies>({
    logbook: () => ({ markSeen }),
  });
  await markLogbookSeen(dependencies, "session", 0);
  expect(markSeen).not.toHaveBeenCalled();
  await expect(
    markLogbookSeen(dependencies, "session", 4),
  ).resolves.toBeUndefined();
  expect(markSeen).toHaveBeenCalledWith("session", 4);
});
