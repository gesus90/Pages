import { expect, it, vi } from "vitest";

import { WorkItemNumbering } from "./WorkItemNumbering";

import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";

function doubleOf<Type>(value: unknown): Type {
  return value as Type;
}

function setup(): {
  readonly numbering: WorkItemNumbering;
  readonly findOrCreateProjectKey: ReturnType<typeof vi.fn>;
  readonly reserveNumbers: ReturnType<typeof vi.fn>;
} {
  const findOrCreateProjectKey = vi.fn(async () => "PAGE");
  const reserveNumbers = vi.fn(async () => 5);
  return {
    findOrCreateProjectKey,
    numbering: new WorkItemNumbering(
      doubleOf<TaskRepository>({ findOrCreateProjectKey, reserveNumbers }),
    ),
    reserveNumbers,
  };
}

it("reserves numbers and hands the sequence to the work", async () => {
  const { numbering, findOrCreateProjectKey, reserveNumbers } = setup();

  const result = await numbering.run(
    { id: "p1", name: "Pages" },
    2,
    async (sequence) => sequence,
  );

  expect(result).toEqual({ firstNumber: 5, projectKey: "PAGE" });
  expect(findOrCreateProjectKey).toHaveBeenCalledWith("p1", "PAGE");
  expect(reserveNumbers).toHaveBeenCalledWith("p1", 2);
});

it("runs the work of parallel requests one after another", async () => {
  const { numbering } = setup();
  const events: string[] = [];
  const project = { id: "p1", name: "Pages" };

  const first = numbering.run(project, 1, async () => {
    events.push("first start");
    await Promise.resolve();
    events.push("first end");
  });
  const second = numbering.run(project, 1, async () => {
    events.push("second");
  });
  await Promise.all([first, second]);

  expect(events).toEqual(["first start", "first end", "second"]);
});
